import axios, { AxiosInstance } from 'axios';
import { TrelloConfig, TrelloCard, TrelloList, TrelloAction, TrelloMember } from './types.js';
import { createTrelloRateLimiters } from './rate-limiter.js';

export class TrelloClient {
  private axiosInstance: AxiosInstance;
  private rateLimiter;

  constructor(private config: TrelloConfig) {
    console.error(`[TrelloClient] Initializing with boardId: ${config.boardId}`);
    this.axiosInstance = axios.create({
      baseURL: 'https://api.trello.com/1',
      params: {
        key: config.apiKey,
        token: config.token,
      },
      timeout: 10000, // 10 segundos de timeout
    });

    this.rateLimiter = createTrelloRateLimiters();

    // Add rate limiting interceptor
    this.axiosInstance.interceptors.request.use(async (config) => {
      await this.rateLimiter.waitForAvailable();
      console.error(`[TrelloClient] Making request to: ${config.url}`);
      return config;
    });
    
    // Add response interceptor for logging
    this.axiosInstance.interceptors.response.use(
      response => {
        console.error(`[TrelloClient] Response from ${response.config.url}: Status ${response.status}`);
        return response;
      },
      error => {
        if (axios.isAxiosError(error)) {
          console.error(`[TrelloClient] Error from ${error.config?.url}: ${error.message}`);
          if (error.response) {
            console.error(`[TrelloClient] Response status: ${error.response.status}`);
            console.error(`[TrelloClient] Response data:`, error.response.data);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private async handleRequest<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          // Rate limit exceeded, wait and retry
          console.error(`[TrelloClient] Rate limit exceeded, waiting 1 second before retry`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return this.handleRequest(request);
        }
        if (error.response?.status === 401) {
          console.error(`[TrelloClient] Authentication error: Invalid API key or token`);
          throw new Error(`Trello API authentication error: Please check your API key and token`);
        }
        if (error.response?.status === 404) {
          console.error(`[TrelloClient] Resource not found error`);
          throw new Error(`Trello API error: Resource not found. Check if board/list/card IDs are correct`);
        }
        throw new Error(`Trello API error: ${error.response?.data?.message ?? error.message}`);
      }
      console.error(`[TrelloClient] Non-Axios error:`, error);
      throw error;
    }
  }

  async getCardsByList(listId: string): Promise<TrelloCard[]> {
    console.error(`[TrelloClient] Getting cards for list: ${listId}`);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/lists/${listId}/cards`);
      return response.data;
    });
  }

  async getLists(): Promise<TrelloList[]> {
    console.error(`[TrelloClient] Getting lists for board: ${this.config.boardId}`);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/boards/${this.config.boardId}/lists`);
      return response.data;
    });
  }

  async getRecentActivity(limit: number = 10): Promise<TrelloAction[]> {
    console.error(`[TrelloClient] Getting recent activity for board: ${this.config.boardId} (limit: ${limit})`);
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get(`/boards/${this.config.boardId}/actions`, {
        params: { limit },
      });
      return response.data;
    });
  }

  async addCard(params: {
    listId: string;
    name: string;
    description?: string;
    dueDate?: string;
    labels?: string[];
  }): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post('/cards', {
        idList: params.listId,
        name: params.name,
        desc: params.description,
        due: params.dueDate,
        idLabels: params.labels,
      });
      return response.data;
    });
  }

  async updateCard(params: {
    cardId: string;
    name?: string;
    description?: string;
    dueDate?: string;
    labels?: string[];
  }): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/cards/${params.cardId}`, {
        name: params.name,
        desc: params.description,
        due: params.dueDate,
        idLabels: params.labels,
      });
      return response.data;
    });
  }

  async archiveCard(cardId: string): Promise<TrelloCard> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/cards/${cardId}`, {
        closed: true,
      });
      return response.data;
    });
  }

  async addList(name: string): Promise<TrelloList> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.post('/lists', {
        name,
        idBoard: this.config.boardId,
      });
      return response.data;
    });
  }

  async archiveList(listId: string): Promise<TrelloList> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.put(`/lists/${listId}/closed`, {
        value: true,
      });
      return response.data;
    });
  }

  async getMyCards(): Promise<TrelloCard[]> {
    return this.handleRequest(async () => {
      const response = await this.axiosInstance.get('/members/me/cards');
      return response.data;
    });
  }
}
