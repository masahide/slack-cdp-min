declare module "*.hbs?raw" {
  const template: string;
  export default template;
}

// See https://kit.svelte.dev/docs/types#app
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }
}

export {};

declare module "$env/static/private" {
  export const OPENAI_API_KEY: string | undefined;
}

declare module "openai" {
  export default class OpenAI {
    constructor(options: { apiKey: string });
    responses: {
      create(payload: Record<string, unknown>): Promise<unknown>;
    };
  }
}
