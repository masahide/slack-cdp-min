type OpenAIClient = {
  responses: {
    create(payload: Record<string, unknown>): Promise<unknown>;
  };
};

type OpenAIConstructor = new (options: { apiKey: string }) => OpenAIClient;

export async function createOpenAIClient(options: { apiKey: string }): Promise<OpenAIClient> {
  const dynamicImport = new Function("specifier", "return import(specifier);") as (
    specifier: string
  ) => Promise<{ default: OpenAIConstructor }>;

  try {
    const { default: OpenAI } = await dynamicImport("openai");
    return new OpenAI({ apiKey: options.apiKey });
  } catch (error) {
    throw new Error("OpenAI SDK が見つかりません。`pnpm add openai` を実行してください。", {
      cause: error,
    });
  }
}
