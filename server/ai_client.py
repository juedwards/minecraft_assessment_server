"""AI client wrapper for Azure OpenAI calls."""
import os
import logging
import traceback
logger = logging.getLogger(__name__)

# Log environment state (do not print secrets)
logger.info("AI client bootstrap — env flags: AZURE_USE_DEFAULT_CREDENTIALS=%s, AZURE_OPENAI_ENDPOINT_present=%s, AZURE_OPENAI_API_KEY_present=%s, OPENAI_API_KEY_present=%s",
            os.getenv('AZURE_USE_DEFAULT_CREDENTIALS'),
            bool(os.getenv('AZURE_OPENAI_ENDPOINT')),
            bool(os.getenv('AZURE_OPENAI_API_KEY')),
            bool(os.getenv('OPENAI_API_KEY')))

# Initialization state
client = None
client_type = None  # 'azure_sdk', 'azure_openai', 'openai_modern', 'legacy'
init_attempted = False
init_error = None


def init_client(force=False):
    """Attempt to initialize the AI client. This function is safe to call multiple times.
    If force=True it will retry initialization even if a previous attempt failed.
    """
    global client, init_attempted, init_error
    if init_attempted and not force:
        return
    init_attempted = True
    init_error = None
    # Prefer the official Azure SDK when using default credentials — it accepts DefaultAzureCredential
    try:
        from openai import OpenAI
        from azure.identity import DefaultAzureCredential, get_bearer_token_provider
        azure_endpoint = os.getenv('AZURE_OPENAI_ENDPOINT')
        use_default = os.getenv('AZURE_USE_DEFAULT_CREDENTIALS', 'false').lower() in ('1', 'true', 'yes')
        if use_default and azure_endpoint:
            try:
                logger.info('Attempting Azure SDK OpenAIClient with DefaultAzureCredential (endpoint=%s)', azure_endpoint)
                token_provider = get_bearer_token_provider(
                    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
                )
                client = OpenAI(base_url=azure_endpoint, api_key=token_provider)
                logger.info('✅ Azure SDK OpenAIClient initialized with DefaultAzureCredential')
            except Exception as e:
                logger.warning('Azure SDK OpenAIClient with DefaultAzureCredential failed: %s', e)
                logger.debug(traceback.format_exc())
    except Exception:
        logger.error('Azure SDK OpenAIClient or DefaultAzureCredential not available, AI capabilities disabled')

# Attempt initial client bootstrap at import time
init_client()

async def analyze_prompt(prompt, deployment=None, max_tokens=1000, temperature=0.7):
    deployment = deployment or os.getenv('AZURE_OPENAI_DEPLOYMENT_NAME', 'gpt-4.1')
    try:
        # Ensure the client is initialized (retry if previous attempts failed)
        if client is None:
            logger.info('AI client not initialized; attempting init (attempted_before=%s)', init_attempted)
            # If we attempted before, retry; otherwise perform initial attempt
            if init_attempted:
                init_client(force=True)
            else:
                init_client()
        if client is None:
            logger.warning('AI client still not initialized after init attempt')
        
        logger.info('analyze_prompt called: deployment=%s max_tokens=%d temperature=%s', deployment, max_tokens, temperature)
        logger.debug('Prompt length: %d characters', len(prompt) if prompt else 0)
        logger.info('Using modern client object of type: %s', type(client))
        # Modern clients (AzureOpenAI or OpenAI) expose chat.completions.create
        resp = client.chat.completions.create(
            model=deployment,
            messages=[{'role':'system','content':'You are a Minecraft gameplay assessment expert.'},{'role':'user','content':prompt}],
            max_tokens=max_tokens,
            temperature=temperature
        )
        logger.debug('Raw response type: %s', type(resp))
        try:
            content = resp.choices[0].message.content
            logger.info('Received response with length %d', len(content) if content else 0)
            # Log a short snippet for debugging
            logger.debug('Response snippet: %s', (content[:200] + '...') if content and len(content) > 200 else content)
            return content
        except Exception:
            try:
                content = resp.choices[0]['message']['content']
                logger.info('Received response (alt) length %d', len(content) if content else 0)
                logger.debug('Response snippet: %s', (content[:200] + '...') if content and len(content) > 200 else content)
                return content
            except Exception as e:
                logger.error('Could not extract content from response: %s', e)
                logger.debug(traceback.format_exc())
                raise
    except Exception as e:
        logger.error('Error calling AI: %s', e)
        logger.debug(traceback.format_exc())
        return f'Error: {e}'
