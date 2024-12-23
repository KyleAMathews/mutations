import { PGlite } from '@electric-sql/pglite'

async function main() {
  const pglite = new PGlite()
  
  // Create mutations table
  await pglite.query(`
    CREATE TABLE mutations (
      id SERIAL PRIMARY KEY,
      txid TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      data JSONB NOT NULL,
      timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Create txid index
  await pglite.query(`
    CREATE INDEX idx_mutations_txid ON mutations(txid);
  `)

  // Create table/row index
  await pglite.query(`
    CREATE INDEX idx_mutations_table_row ON mutations(table_name, row_id);
  `)

  // Get connection URL
  const url = await pglite.getConnectionString()
  console.log(`DATABASE_URL=${url}`)
}

main().catch(console.error)
