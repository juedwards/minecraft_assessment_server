import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { AzureKeyCredential } from '@azure/core-auth';

// Note: This TypeScript pilot is for static type checking and gradual migration.
// The project still uses the existing CommonJS runtime ai_client.js. After
// validating types we can replace the runtime file and build outputs.

const endpoint: string | undefined = process.env.AZURE_OPENAI_ENDPOINT;
let client: { type: 'rest-api-key'; apiKey: string } | { type: 'aad'; credential: DefaultAzureCredential } | null = null;
let initAttempted = false;
let initError: any = null;

export function initClient(force = false): void {
  if (initAttempted && !force) return;
  initAttempted = true;
  initError = null;
  if (!endpoint) {
    console.error('AZURE_OPENAI_ENDPOINT not set — Azure OpenAI disabled');
    return;
  }

  try {
    const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
    if (apiKey) {
      client = { type: 'rest-api-key', apiKey };
      console.info('Configured to use AZURE_OPENAI_KEY for REST calls');
      return;
    }

    const credential = new DefaultAzureCredential();
    client = { type: 'aad', credential };
    console.info('Configured to use DefaultAzureCredential for REST calls');
  } catch (err) {
    initError = err;
    console.error('Failed to initialize credentials for Azure OpenAI', err);
  }
}

export async function analyzePrompt(prompt: string, deployment?: string, maxTokens = 1000, temperature = 0.7): Promise<string> {
  deployment = deployment || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';

  if (!client) initClient();
  if (!client) return `Error: Azure OpenAI client not initialized (${initError || 'no endpoint/credentials'})`;
  if (!endpoint) return `Error: AZURE_OPENAI_ENDPOINT not configured`;

  // SDK usage (AzureOpenAI from 'openai') could be attempted from here in future.
  // Current implementation (pilot) leaves the REST implementation in the JS runtime.
  return 'TypeScript pilot: no runtime call performed. Run typecheck to validate types.';
}

export default { initClient, analyzePrompt };