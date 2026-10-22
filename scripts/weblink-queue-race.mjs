import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import pg from 'pg'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createDispatchJournal } from './print-bridge/dispatch.mjs'
import { createWeblinkQueueWorker } from './print-bridge/queue.mjs'

/** Runs inside the existing isolated concurrency database, never a hosted DB. */
export async function raceWeblinkQueue({ setup, connectionString }) {
  const owner = randomUUID()
  const deviceUser = randomUUID()
  const printer = randomUUID()
  const clients = []
  let root
  async function session(id, anonymous = false) {
    const client = new pg.Client({
      connectionString,
      application_name: `weblink_queue_race_${randomUUID()}`,
    })
    await client.connect()
    clients.push(client)
    await client.query('set role authenticated')
    await client.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({
        sub: id,
        role: 'authenticated',
        is_anonymous: anonymous,
      }),
    ])
    return client
  }
  try {
    await setup.query(
      'insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',
      [owner, `${owner}@example.test`],
    )
    await setup.query('insert into auth.users(id) values($1)', [deviceUser])
    const admin = await session(owner)
    const tenant = (
      await admin.query("select create_tenant('Weblink race',$1,$2) id", [
        `web-${randomUUID()}`,
        randomUUID(),
      ])
    ).rows[0].id
    const seller = (
      await admin.query(
        "select register_seller($1,$2,'Synthetic','seller@weblink.test','') id",
        [tenant, randomUUID()],
      )
    ).rows[0].id
    await setup.query(
      "insert into printers(id,tenant_id,name,transport,address,created_by) values($1,$2,'Weblink','weblink','',$3)",
      [printer, tenant, owner],
    )
    const code = (
      await admin.query('select create_print_pairing_code($1,$2) value', [
        tenant,
        printer,
      ])
    ).rows[0].value.code
    const device = await session(deviceUser, true)
    await device.query("select pair_print_device($1,'Bridge','test')", [code])
    const otherConnection = await session(deviceUser, true)
    const workers = [device, otherConnection]
    async function queue() {
      const id = randomUUID()
      await admin.query(
        "select queue_print_job($1,$2,$3,'onboarding','zpl-v1','seller',$4,'^XA^FDRace^FS^XZ',1)",
        [tenant, id, printer, seller],
      )
      return id
    }
    async function race(attempts) {
      await setup.query('begin')
      await setup.query('select id from tenants where id=$1 for update', [
        tenant,
      ])
      const requests = workers.map((worker, index) =>
        worker.query('select claim_weblink_print_job($1,$2,$3) value', [
          tenant,
          printer,
          attempts[index],
        ]),
      )
      let waiting = 0
      for (let i = 0; i < 100; i++) {
        waiting = (
          await setup.query(
            "select count(*)::int n from pg_stat_activity where application_name like 'weblink_queue_race_%' and wait_event_type='Lock'",
          )
        ).rows[0].n
        if (waiting === 2) break
        await pause(20)
      }
      await setup.query('commit')
      const results = await Promise.all(requests)
      assert.equal(
        waiting,
        2,
        'both connections must contend on the tenant lock',
      )
      return results.map((result) => result.rows[0].value)
    }
    const firstJob = await queue()
    const firstAttempt = randomUUID()
    const sameAttempt = await race([firstAttempt, firstAttempt])
    assert.equal(sameAttempt.filter((result) => result.canSend).length, 1)
    assert.equal(sameAttempt.filter((result) => !result.canSend).length, 1)
    assert.equal(
      sameAttempt.find((result) => !result.canSend).payload,
      undefined,
    )
    const completion = await Promise.allSettled(
      workers.map((worker, index) =>
        worker.query('select finish_weblink_print_job($1,$2,$3,$4)', [
          tenant,
          firstJob,
          firstAttempt,
          index ? 'outcome_unknown' : 'transport_accepted',
        ]),
      ),
    )
    assert.equal(
      completion.filter((result) => result.status === 'fulfilled').length,
      1,
    )
    assert.match(
      completion.find((result) => result.status === 'rejected').reason.message,
      /PRINT_JOB_DECIDED/,
    )
    const secondJob = await queue()
    const differentAttempts = await race([randomUUID(), randomUUID()])
    assert.equal(
      differentAttempts.filter((result) => result?.canSend).length,
      1,
    )
    assert.equal(
      differentAttempts.filter((result) => result === null).length,
      1,
    )
    assert.equal(differentAttempts.find(Boolean).jobId, secondJob)
    assert.equal(
      (
        await setup.query(
          "select count(*)::int n from access_events where tenant_id=$1 and action='print.dispatch_reserved'",
          [tenant],
        )
      ).rows[0].n,
      2,
    )
    // Exercise the real worker with committed database RPCs and a lost reply.
    // A fresh local journal cannot undo the reservation held by PostgreSQL.
    const thirdJob = await queue()
    const lostAttempt = randomUUID()
    root = await mkdtemp(join(tmpdir(), 'komisio-web-race-'))
    let loseReply = true
    const rpc = async (name, args) => {
      assert.equal(name, 'claim_weblink_print_job')
      const result = (
        await device.query('select claim_weblink_print_job($1,$2,$3) value', [
          args.p_tenant,
          args.p_printer,
          args.p_attempt,
        ])
      ).rows[0].value
      if (loseReply) {
        loseReply = false
        throw new Error('simulated lost committed reply')
      }
      return result
    }
    const options = {
      scope: {
        tenantId: tenant,
        printerId: printer,
        deviceId: (await device.query('select print_device_context() value'))
          .rows[0].value.deviceId,
      },
      rpc,
      authorize: async () => true,
      send: async () => assert.fail('a recovered attempt must never send'),
    }
    const worker = createWeblinkQueueWorker({
      ...options,
      journal: await createDispatchJournal(join(root, 'original')),
    })
    assert.equal((await worker.run(lostAttempt)).state, 'claim_unknown')
    const restarted = createWeblinkQueueWorker({
      ...options,
      journal: await createDispatchJournal(join(root, 'fresh')),
    })
    assert.deepEqual(await restarted.run(lostAttempt), {
      jobId: thirdJob,
      attemptId: lostAttempt,
      state: 'held',
      recordedState: 'dispatching',
    })
    console.log(
      'PASS: concurrent Weblink claims grant one send; retries have no payload; conflicting completion cannot overwrite evidence.',
    )
    console.log(
      'PASS: real queue worker cannot resend after a committed claim loses its response and local journal state is replaced.',
    )
  } finally {
    await setup.query('rollback').catch(() => {})
    await Promise.all(clients.map((client) => client.end()))
    if (root) {
      assert.equal(dirname(resolve(root)), resolve(tmpdir()))
      assert.ok(basename(root).startsWith('komisio-web-race-'))
      await rm(root, { recursive: true, force: true })
    }
  }
}
