import { PGlite } from '@electric-sql/pglite'
import { DeltaOperation } from './delta'

// Helper type for the result of applying mutations
export type MutationResult = {
  txid: string
  changes: Array<{
    operation: string
    path: string
    value?: unknown
  }>
}

function isJsonPath(path: string): boolean {
  return path.includes('->')
}

function normalizeJsonPath(path: string): string {
  return path.split('->').map(p => `'${p}'`).join('->')
}

function castValue(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value === null) return 'NULL'
  if (Array.isArray(value)) return `ARRAY[${value.map(v => castValue(v)).join(', ')}]`
  if (typeof value === 'object') return `'${JSON.stringify(value)}'::jsonb`
  return String(value)
}

function buildJsonPath(parts: string[]): string {
  return `'{${parts.map(p => p.replace(/'/g, "''")).join(',')}}'`
}

function buildNestedJsonSet(field: string, parts: string[], value: unknown): string {
  // Build a chain of jsonb_set calls to ensure all intermediate objects exist
  let sql = `COALESCE(${field}, '{}'::jsonb)`
  const n = parts.length
  
  for (let i = 0; i < n - 1; i++) {
    const pathParts = parts.slice(0, i + 1)
    sql = `jsonb_set(${sql}, ${buildJsonPath(pathParts)}, COALESCE(${field}#>${buildJsonPath(pathParts)}, '{}'::jsonb), true)`
  }
  
  // Set the final value
  return `jsonb_set(${sql}, ${buildJsonPath(parts)}, '${JSON.stringify(value)}'::jsonb, true)`
}

export async function applyMutations(
  db: PGlite,
  tableName: string,
  rowId: string | number,
  deltas: DeltaOperation[]
): Promise<MutationResult | Error> {
  try {
    await db.query('BEGIN')
    try {
      const { rows: [{ txid_current: txid }] } = await db.query('SELECT txid_current()')
      const changes: MutationResult['changes'] = []

      for (const delta of deltas) {
        // Handle $set operations
        if (delta.$set && Object.keys(delta.$set).length > 0) {
          for (const [path, value] of Object.entries(delta.$set)) {
            let sql: string
            if (isJsonPath(path)) {
              const parts = path.split('->')
              const field = parts[0]
              sql = `${field} = ${buildNestedJsonSet(field, parts.slice(1), value)}`
            } else {
              sql = `${path} = ${castValue(value)}`
            }

            await db.query(
              `UPDATE ${tableName} SET ${sql} WHERE id = $1`,
              [rowId]
            )

            changes.push({
              operation: '$set',
              path,
              value
            })
          }
        }

        // Handle $unset operations
        if (delta.$unset && Object.keys(delta.$unset).length > 0) {
          for (const path of Object.keys(delta.$unset)) {
            let sql: string
            if (isJsonPath(path)) {
              const parts = path.split('->')
              const field = parts[0]
              const jsonPath = buildJsonPath(parts.slice(1))
              sql = `${field} = ${field} #- ${jsonPath}`
            } else {
              sql = `${path} = NULL`
            }

            await db.query(
              `UPDATE ${tableName} SET ${sql} WHERE id = $1`,
              [rowId]
            )

            changes.push({
              operation: '$unset',
              path
            })
          }
        }

        // Handle array operations
        const arrayOps = {
          $push: (path: string, value: unknown) => 
            `${path} = array_append(${path}, ${castValue(value)})`,
          $pull: (path: string, value: unknown) => 
            `${path} = array_remove(${path}, ${castValue(value)})`,
          $pop: (path: string, value: 1 | -1) => value === 1
            ? `${path} = (CASE WHEN array_length(${path}, 1) > 0 THEN ${path}[1:array_length(${path}, 1)-1] ELSE ${path} END)`
            : `${path} = (CASE WHEN array_length(${path}, 1) > 0 THEN ${path}[2:array_length(${path}, 1)] ELSE ${path} END)`,
          $append: (path: string, values: unknown[]) => 
            `${path} = ${path} || ${castValue(values)}`,
          $prepend: (path: string, values: unknown[]) => 
            `${path} = ${castValue(values)} || ${path}`,
          $splice: (path: string, [start, deleteCount, ...items]: [number, number, ...unknown[]]) => 
            `${path} = (
              CASE WHEN array_length(${path}, 1) >= ${start}
              THEN
                array_cat(
                  array_cat(
                    ${path}[1:${start}],
                    ${castValue(items)}
                  ),
                  ${path}[${start + deleteCount + 1}:array_length(${path}, 1)]
                )
              ELSE ${path}
              END
            )`
        }

        for (const [op, fn] of Object.entries(arrayOps)) {
          const opChanges = delta[op as keyof typeof arrayOps]
          if (!opChanges || Object.keys(opChanges).length === 0) continue

          for (const [path, value] of Object.entries(opChanges)) {
            const sql = fn(path, value)
            await db.query(
              `UPDATE ${tableName} SET ${sql} WHERE id = $1`,
              [rowId]
            )

            changes.push({
              operation: op,
              path,
              value
            })
          }
        }
      }

      await db.query('COMMIT')
      return { txid, changes }
    } catch (error) {
      await db.query('ROLLBACK')
      throw error
    }
  } catch (error) {
    return error as Error
  }
}

// Helper to create a test database connection
export async function createTestDb() {
  const db = new PGlite()

  // Create test table
  await db.query(`
    CREATE TABLE todos (
      id SERIAL PRIMARY KEY,
      title TEXT,
      completed BOOLEAN DEFAULT FALSE,
      tags TEXT[] DEFAULT '{}',
      metadata JSONB DEFAULT '{}'::jsonb
    )
  `)

  return db
}
