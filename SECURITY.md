# Security

## Reporting

Please use GitHub's private vulnerability reporting for this repository:
https://github.com/Komisio/komisio/security/advisories/new

Do not disclose vulnerability details or credentials in public issues. This is
an early development preview; there is no guaranteed response-time commitment.

## Principles

- **Membership is the only source of access.** A user acts in a tenant only
  through a row in the membership table. A tenant id in a token, a URL or a
  request body grants nothing by itself.
- **Access is enforced by the database.** Row Level Security and grants are
  the boundary; application code and session flags are not. Privileged server
  jobs use a separate role and are audited.
- **Every write with financial consequence goes through the engine**, carries
  an identified actor (user, agent or system job), and is logged.
- **Agents stage; people approve.** Writes proposed by AI agents are staged as
  pending operations with a risk level and executed only after approval,
  unless a scope explicitly allows auto-execution for low-risk operations.
- **Secrets never enter the repository.** Payout details and personal
  identifiers are encrypted by the application layer; personal identity
  numbers are never stored in clear text.
- **Nothing with legal weight is deleted.** Retention rules are enforced in
  the database.

These principles are documented in `ARCHITECTURE.md` and proven by tests as
the corresponding parts are built.
