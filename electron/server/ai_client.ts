import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { AzureOpenAI } from "openai";


// Note: This TypeScript pilot is for static type checking and gradual migration.
// The project still uses the existing CommonJS runtime ai_client.js. After
// validating types we can replace the runtime file and build outputs.

const endpoint: string | undefined = process.env.AZURE_OPENAI_ENDPOINT;
// sdkClient will hold either an AzureOpenAI instance (from 'openai') or OpenAIClient (from '@azure/openai')
let sdkClient: any = null;
let sdkClientType: 'openai_azure' | 'azure_sdk' | null = null;
let initAttempted = false;
let initError: any = null;
// Optional dev fallback: if set, analyzePrompt will return this text instead of calling Azure OpenAI
let fallbackResponse: string | null = process.env.AZURE_OPENAI_FALLBACK_RESPONSE || null;

export function setFallbackResponse(resp: string | null): void {
  fallbackResponse = resp;
}

export function initClient(force = false): void {
  if (initAttempted && !force) return;
  initAttempted = true;
  initError = null;
  if (!endpoint) {
    console.error('AZURE_OPENAI_ENDPOINT not set — Azure OpenAI disabled');
    console.info('To enable Azure OpenAI set environment variables:');
    console.info('  AZURE_OPENAI_ENDPOINT=https://<your-resource-name>.openai.azure.com');
    console.info('  and either AZURE_OPENAI_KEY=<your-api-key>');
    console.info('  or configure Azure AD credentials: AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET');
    if (fallbackResponse) console.info('AZURE_OPENAI_FALLBACK_RESPONSE is set — using fallback response for analyzePrompt');
    return;
  }

  try {
    try {
      // const endpoint = "https://skillcraftai.cognitiveservices.azure.com/";
      // const deployment = "gpt-4.1";
      // const credential = new DefaultAzureCredential();
      // const scope = "https://cognitiveservices.azure.com/.default";
      // const azureADTokenProvider = getBearerTokenProvider(credential, scope);
      // const apiVersion = "2024-04-01-preview";
      // const options = { endpoint, azureADTokenProvider, deployment, apiVersion }
      // const sdkClient = new AzureOpenAI(options);
      // sdkClientType = 'openai_azure';
      // console.info('Configured to use AzureOpenAI (openai package) with DefaultAzureCredential (dynamic require)');
      return;
    } catch (e) {
      console.warn('AzureOpenAI (openai package) AAD initialization failed, will try DefaultAzureCredential with @azure/openai', e);
    }
  } catch (err) {
    initError = err;
    console.error('Failed to initialize AI client', err);
  }
}

export async function analyzePrompt(prompt: string, deployment?: string, maxTokens = 1000, temperature = 0.7): Promise<string> {

  if (!sdkClient) initClient();
  // if (!sdkClient) return `Error: Azure OpenAI client not initialized (${initError || 'no endpoint/credentials'})`;
  // if (!endpoint) return `Error: AZURE_OPENAI_ENDPOINT not configured`;

  try {
      const endpoint = "https://skillcraftai.cognitiveservices.azure.com/";
      const deployment = "gpt-4.1";
      const credential = new DefaultAzureCredential();
      const scope = "https://cognitiveservices.azure.com/.default";
      const azureADTokenProvider = getBearerTokenProvider(credential, scope);
      const apiVersion = "2024-04-01-preview";
      const options = { endpoint, azureADTokenProvider, deployment, apiVersion }
      const sdkClient1 = new AzureOpenAI(options);
      const modelName = "gpt-4.1";
      const resp: any = await sdkClient1.chat.completions.create(
        { messages: [
          { role: 'system', content: 'You are a Minecraft gameplay assessment expert.' },
          { role: 'user', content: prompt }
        ], 
        model: modelName,
        max_tokens: maxTokens, 
        temperature: temperature });
      // Extract content
      const content = resp?.choices?.[0]?.message?.content || resp?.choices?.[0]?.message?.content;
      if (content) return content;
      return `Error: Unexpected response shape from AzureOpenAI (openai SDK)`;

    // if (sdkClientType === 'azure_sdk') {
    //   // @azure/openai client usage
    //   const resp: any = await sdkClient.getChatCompletions(deployment, {
    //     messages: [
    //       { role: 'system', content: 'You are a Minecraft gameplay assessment expert.' },
    //       { role: 'user', content: prompt }
    //     ],
    //     maxTokens,
    //     temperature,
    //   });
    //   const content = resp?.choices?.[0]?.message?.content || resp?.choices?.[0]?.message?.content;
    //   if (content) return content;
    //   return `Error: Unexpected response shape from @azure/openai OpenAIClient`;
    // }

    // return `Error: Unsupported client type`;
  } catch (err) {
    console.error('analyzePrompt runtime error', err);
    return `Error: ${err}`;
  }
}

// Attempt initial client bootstrap at import time (mirrors Python behavior)
initClient();

export default { initClient, analyzePrompt, setFallbackResponse };