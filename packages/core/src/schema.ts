export interface StandardSchemaV1<Input = unknown, Output = Input> {
  // eslint-disable-next-line
  readonly '~standard': {
    /**
     * The version number of the standard.
     */
    readonly version: 1
    /**
     * The vendor name of the schema library.
     */
    readonly vendor: string
    /**
     * Validates unknown input values.
     */
    readonly validate: (
      value: unknown
    ) => Result<Output> | Promise<Result<Output>>
    /**
     * Inferred types associated with the schema.
     */
    readonly types?: Types<Input, Output> | undefined
  }
}

export interface Result<T> {
  value?: T
  issues?: ReadonlyArray<Issue>
}

export interface Issue {
  message: string
  path?: ReadonlyArray<PathItem>
}

export type PathItem = string | number | { key: string | number }

export interface Types<Input, Output> {
  input: Input
  output: Output
}

// Helper type to extract the output type from a schema
export type InferOutput<T> =
  T extends StandardSchemaV1<unknown, infer Output> ? Output : never

// Helper type to extract the input type from a schema
export type InferInput<T> = T extends StandardSchemaV1<infer I> ? I : never

// Schema validation error
export class SchemaError extends Error {
  public readonly issues: ReadonlyArray<Issue>
  constructor(issues: ReadonlyArray<Issue>) {
    super(issues[0]?.message ?? `Validation failed`)
    this.name = `SchemaError`
    this.issues = issues
  }
}
