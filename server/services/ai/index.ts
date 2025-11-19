
import { IAiProvider, AiProviderType } from "./types";
import { OpenAIProvider } from "./openai-provider";
import { GeminiProvider } from "./gemini-provider";
import { PerplexityProvider } from "./perplexity-provider";

export class UnifiedAiService {
  private providers: Map<AiProviderType, IAiProvider> = new Map();
  private defaultProvider: AiProviderType = 'openai';

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    // Initialize OpenAI (always attempted)
    if (process.env.OPENAI_API_KEY) {
      this.providers.set('openai', new OpenAIProvider());
    }

    // Initialize Gemini
    if (process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY) {
      this.providers.set('gemini', new GeminiProvider());
    }

    // Initialize Perplexity
    if (process.env.PERPLEXITY_API_KEY) {
      this.providers.set('perplexity', new PerplexityProvider());
    }
    
    // Fallback logic for default provider
    if (!this.providers.has('openai') && this.providers.size > 0) {
      this.defaultProvider = this.providers.keys().next().value;
    }
  }

  getProvider(type?: AiProviderType): IAiProvider {
    const targetType = type || this.defaultProvider;
    const provider = this.providers.get(targetType);
    
    if (!provider) {
      // Fallback to any available provider
      if (this.providers.size > 0) {
        const fallback = this.providers.values().next().value;
        console.warn(`Provider ${targetType} not available, falling back to ${fallback.getName()}`);
        return fallback;
      }
      throw new Error(`No AI providers available. Requested: ${targetType}`);
    }
    
    return provider;
  }

  // Convenience method to access the singleton
  static instance: UnifiedAiService;
  static getInstance(): UnifiedAiService {
    if (!UnifiedAiService.instance) {
      UnifiedAiService.instance = new UnifiedAiService();
    }
    return UnifiedAiService.instance;
  }
}

export const aiService = UnifiedAiService.getInstance();

