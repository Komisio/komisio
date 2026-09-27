-- Complete presentation text for the existing platform vocabulary. Tenant
-- definitions, stored values and suggested category values are not changed.
-- Existing labels win if already present; only missing translations are added.
with translations(slug, labels, help) as (values
 ('description','{"no":"Beskrivelse","dk":"Beskrivelse","fi":"Kuvaus","de":"Beschreibung","es":"Descripción","it":"Descrizione"}'::jsonb,'{}'::jsonb),
 ('category','{"no":"Kategori","dk":"Kategori","fi":"Luokka","de":"Kategorie","es":"Categoría","it":"Categoria"}'::jsonb,'{"no":"For navigering og rapporter. Varetypen foreslår en kategori.","dk":"Til navigation og rapporter. Varetypen foreslår en kategori.","fi":"Selausta ja raportteja varten. Tuotetyyppi ehdottaa luokkaa.","de":"Für Navigation und Berichte. Der Artikeltyp schlägt eine Kategorie vor.","es":"Para navegar y generar informes. El tipo de artículo sugiere una categoría.","it":"Per la navigazione e i rapporti. Il tipo di articolo suggerisce una categoria."}'::jsonb),
 ('condition','{"no":"Tilstand","dk":"Stand","fi":"Kunto","de":"Zustand","es":"Estado","it":"Condizione"}'::jsonb,'{"no":"Skader, slitasje og annet en kjøper bør vite.","dk":"Skader, slid og andet, en køber bør vide.","fi":"Vauriot, kuluminen ja muut ostajalle tärkeät tiedot.","de":"Schäden, Gebrauchsspuren und alles, was Käufer wissen sollten.","es":"Daños, desgaste y otros detalles que el comprador deba conocer.","it":"Danni, usura e altri dettagli che un acquirente dovrebbe conoscere."}'::jsonb),
 ('brand','{"no":"Merke","dk":"Mærke","fi":"Merkki","de":"Marke","es":"Marca","it":"Marca"}'::jsonb,'{}'::jsonb),
 ('color','{"no":"Farge","dk":"Farve","fi":"Väri","de":"Farbe","es":"Color","it":"Colore"}'::jsonb,'{}'::jsonb),
 ('material','{"no":"Materiale","dk":"Materiale","fi":"Materiaali","de":"Material","es":"Material","it":"Materiale"}'::jsonb,'{}'::jsonb),
 ('size','{"no":"Størrelse","dk":"Størrelse","fi":"Koko","de":"Größe","es":"Talla","it":"Taglia"}'::jsonb,'{}'::jsonb),
 ('fit','{"no":"Passform","dk":"Pasform","fi":"Malli","de":"Passform","es":"Corte","it":"Vestibilità"}'::jsonb,'{}'::jsonb),
 ('height_cm','{"no":"Høyde","dk":"Højde","fi":"Korkeus","de":"Höhe","es":"Altura","it":"Altezza"}'::jsonb,'{}'::jsonb),
 ('socket','{"no":"Sokkel","dk":"Fatning","fi":"Lampun kanta","de":"Fassung","es":"Casquillo","it":"Attacco"}'::jsonb,'{}'::jsonb),
 ('max_wattage','{"no":"Maksimal effekt","dk":"Maksimal effekt","fi":"Enimmäisteho","de":"Maximale Leistung","es":"Potencia máxima","it":"Potenza massima"}'::jsonb,'{"no":"Høyeste pæreeffekt armaturen tåler, ikke effekten til pæren som sitter i.","dk":"Den højeste pæreeffekt, armaturet tåler, ikke effekten på den monterede pære.","fi":"Valaisimen sallima lampun enimmäisteho, ei siinä olevan lampun teho.","de":"Die höchste zulässige Lampenleistung der Leuchte, nicht die Leistung der eingesetzten Lampe.","es":"Potencia máxima de bombilla admitida por la luminaria, no la de la bombilla instalada.","it":"Potenza massima della lampadina ammessa dalla lampada, non quella della lampadina installata."}'::jsonb),
 ('dimmable','{"no":"Dimbar","dk":"Dæmpbar","fi":"Himmennettävä","de":"Dimmbar","es":"Regulable","it":"Dimmerabile"}'::jsonb,'{}'::jsonb)
)
update public.attribute_definitions d set labels=t.labels || d.labels, help=t.help || d.help
from translations t where d.tenant_id is null and d.slug=t.slug;

with translations(slug, labels) as (values
 ('sweater','{"no":"Genser","dk":"Trøje","fi":"Neule","de":"Pullover","es":"Jersey","it":"Maglione"}'::jsonb),
 ('lamp','{"no":"Lampe","dk":"Lampe","fi":"Valaisin","de":"Lampe","es":"Lámpara","it":"Lampada"}'::jsonb)
)
update public.item_types t set labels=x.labels || t.labels
from translations x where t.tenant_id is null and t.slug=x.slug;

-- The immutable choices JSON includes presentation labels. Publish a new
-- platform definition instead of rewriting historical choices or relaxing
-- the trigger. Stable ids, array order, sort metadata, type and unit remain.
with translations(slug, choices) as (values
 ('fit','{"womens":{"no":"Dame","dk":"Dame","fi":"Naisten","de":"Damen","es":"Mujer","it":"Donna"},"mens":{"no":"Herre","dk":"Herre","fi":"Miesten","de":"Herren","es":"Hombre","it":"Uomo"},"unisex":{"no":"Unisex","dk":"Unisex","fi":"Unisex","de":"Unisex","es":"Unisex","it":"Unisex"},"childrens":{"no":"Barn","dk":"Børn","fi":"Lasten","de":"Kinder","es":"Infantil","it":"Bambino"}}'::jsonb),
 ('socket','{"e27":{"no":"E27","dk":"E27","fi":"E27","de":"E27","es":"E27","it":"E27"},"e14":{"no":"E14","dk":"E14","fi":"E14","de":"E14","es":"E14","it":"E14"},"gu10":{"no":"GU10","dk":"GU10","fi":"GU10","de":"GU10","es":"GU10","it":"GU10"},"g9":{"no":"G9","dk":"G9","fi":"G9","de":"G9","es":"G9","it":"G9"},"integrated":{"no":"Integrert LED","dk":"Indbygget LED","fi":"Kiinteä LED","de":"Integrierte LED","es":"LED integrado","it":"LED integrato"}}'::jsonb)
)
insert into public.attribute_definitions(tenant_id,slug,version,data_type,unit,choices,labels,help,active,created_by)
select null,d.slug,2,d.data_type,d.unit,
 (select jsonb_agg(jsonb_set(c.value,'{labels}',(t.choices->(c.value->>'id')) || (c.value->'labels')) order by c.ordinality)
  from jsonb_array_elements(d.choices) with ordinality c),
 d.labels,d.help,d.active,d.created_by
from public.attribute_definitions d join translations t on t.slug=d.slug
where d.tenant_id is null and d.version=1;
