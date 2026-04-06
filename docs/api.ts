/**
 * YapBay API Client
 *
 * A comprehensive, type-safe API client for the YapBay trading platform.
 * Handles authentication, network management, and all CRUD operations.
 */

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

// Define RequestInit type for fetch API compatibility
interface RequestInit {
  body?: string | null;
  cache?: string;
  credentials?: string;
  headers?: Record<string, string> | string[][];
  integrity?: string;
  keepalive?: boolean;
  method?: string;
  mode?: string;
  redirect?: string;
  referrer?: string;
  referrerPolicy?: string;
  signal?: any;
  window?: any;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: string;
  message?: string;
  network?: string;
  success?: boolean;
}

export interface PaginatedResponse<T = unknown> extends ApiResponse<T> {
  pagination?: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface NetworkConfig {
  arbitratorAddress: string;
  chainId: number;
  contractAddress?: string;
  createdAt: Date;
  id: number;
  isActive: boolean;
  isTestnet: boolean;
  name: string;
  networkFamily: 'evm' | 'solana';
  programId?: string;
  rpcUrl: string;
  updatedAt: Date;
  usdcMint?: string;
  wsUrl?: string;
}

export interface Account {
  available_from?: string;
  available_to?: string;
  created_at: Date;
  email: string;
  id: number;
  phone_country_code?: string;
  phone_number?: string;
  profile_photo_url?: string;
  role: 'user' | 'admin';
  telegram_id?: number;
  telegram_username?: string;
  timezone?: string;
  updated_at: Date;
  username: string;
  wallet_address: string;
}

export interface PublicAccount {
  available_from?: string;
  available_to?: string;
  created_at: Date;
  id: number;
  profile_photo_url?: string;
  telegram_id?: number;
  telegram_username?: string;
  timezone?: string;
  username: string;
  wallet_address: string;
}

export interface Offer {
  created_at: Date;
  creator_account_id: number;
  escrow_deposit_time_limit: string;
  fiat_currency: string;
  fiat_payment_time_limit: string;
  id: number;
  max_amount: number;
  min_amount: number;
  network_id: number;
  offer_type: 'BUY' | 'SELL';
  rate_adjustment: number;
  terms: string;
  token: string;
  total_available_amount: number;
  updated_at: Date;
}

export interface Trade {
  created_at: Date;
  destination_bank?: string;
  destination_fiat_currency: string;
  from_bank?: string;
  from_fiat_currency: string;
  id: number;
  leg1_buyer_account_id: number;
  leg1_cancelled_at?: Date;
  leg1_crypto_amount: number;
  leg1_crypto_token: string;
  leg1_escrow_deposit_deadline: Date;
  leg1_escrow_onchain_id?: number;
  leg1_fiat_amount?: number;
  leg1_fiat_currency: string;
  leg1_fiat_paid_at?: Date;
  leg1_fiat_payment_deadline: Date;
  leg1_offer_id: number;
  leg1_released_at?: Date;
  leg1_seller_account_id: number;
  leg1_state: 'CREATED' | 'FUNDED' | 'FIAT_PAID' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
  leg2_offer_id?: number;
  network_id: number;
  overall_status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
  updated_at: Date;
}

export interface Escrow {
  amount: number;
  arbitrator_address: string;
  buyer_address: string;
  completed_at?: Date;
  counter: number;
  created_at: Date;
  current_balance?: number;
  deposit_deadline?: Date;
  dispute_id?: number;
  escrow_address: string;
  escrow_onchain_id?: string;
  escrow_pda?: string;
  escrow_token_account?: string;
  fiat_deadline?: Date;
  fiat_paid: boolean;
  id: number;
  network_family: 'evm' | 'solana';
  network_id: number;
  onchain_escrow_id: number;
  program_id?: string;
  seller_address: string;
  sequential: boolean;
  sequential_escrow_address?: string;
  state:
    | 'CREATED'
    | 'FUNDED'
    | 'RELEASED'
    | 'CANCELLED'
    | 'AUTO_CANCELLED'
    | 'DISPUTED'
    | 'RESOLVED';
  token_type: string;
  trade_id: number;
  trade_onchain_id?: string;
  updated_at: Date;
  version?: string;
}

export interface Transaction {
  block_number?: number;
  created_at: Date;
  error_message?: string;
  gas_used?: number;
  id: number;
  network_id: number;
  receiver_or_contract_address?: string;
  related_escrow_db_id?: number;
  related_trade_id?: number;
  sender_address?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  transaction_hash?: string;
  type:
    | 'CREATE_ESCROW'
    | 'FUND_ESCROW'
    | 'RELEASE_ESCROW'
    | 'CANCEL_ESCROW'
    | 'MARK_FIAT_PAID'
    | 'OPEN_DISPUTE'
    | 'RESPOND_DISPUTE'
    | 'RESOLVE_DISPUTE'
    | 'EVENT'
    | 'OTHER';
}

export interface PriceData {
  [fiat: string]: {
    price: string;
    timestamp: number;
  };
}

export interface HealthStatus {
  apiVersion: {
    version: string;
    gitCommitHash: string;
    gitCommitDate: string;
    gitBranch: string;
    buildDate: string;
    isDirty: boolean;
  };
  contractVersion: string;
  dbStatus: string;
  networks: Array<
    NetworkConfig & {
      status: string;
      error?: string;
      providerChainId?: number;
      providerName?: string;
      warning?: string;
      blockExplorerUrl?: string;
    }
  >;
  status: string;
  summary: {
    totalNetworks: number;
    activeNetworks: number;
    connectedNetworks: number;
    errorNetworks: number;
    evmNetworks: number;
    solanaNetworks: number;
  };
  timestamp: string;
  userWallet: string;
}

// Request interfaces
export interface CreateAccountRequest {
  email: string;
  username: string;
  wallet_address: string;
}

export interface UpdateAccountRequest {
  available_from?: string;
  available_to?: string;
  email?: string;
  phone_country_code?: string;
  phone_number?: string;
  profile_photo_url?: string;
  telegram_id?: number;
  telegram_username?: string;
  timezone?: string;
  username?: string;
}

export interface CreateOfferRequest {
  creator_account_id: number;
  escrow_deposit_time_limit?: string;
  fiat_currency?: string;
  fiat_payment_time_limit?: string;
  max_amount?: number;
  min_amount: number;
  offer_type: 'BUY' | 'SELL';
  rate_adjustment?: number;
  terms?: string;
  token?: string;
  total_available_amount?: number;
}

export interface UpdateOfferRequest {
  escrow_deposit_time_limit?: string | { minutes: number };
  fiat_currency?: string;
  fiat_payment_time_limit?: string | { minutes: number };
  max_amount?: number;
  min_amount?: number;
  offer_type?: 'BUY' | 'SELL';
  rate_adjustment?: number;
  terms?: string;
  token?: string;
  total_available_amount?: number;
}

export interface CreateTradeRequest {
  destination_bank?: string;
  destination_fiat_currency?: string;
  from_bank?: string;
  from_fiat_currency?: string;
  leg1_crypto_amount?: number;
  leg1_fiat_amount?: number;
  leg1_offer_id: number;
  leg2_offer_id?: number;
}

export interface UpdateTradeRequest {
  fiat_paid?: boolean;
  leg1_state?: 'CREATED' | 'FUNDED' | 'FIAT_PAID' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
  overall_status?: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
}

export interface RecordEscrowRequest {
  amount: number;
  buyer: string;
  escrow_id: number;
  escrow_pda?: string;
  escrow_token_account?: string;
  // Solana-specific fields
  program_id?: string;
  seller: string;
  sequential: boolean;
  sequential_escrow_address?: string;
  signature?: string; // Solana
  trade_id: number;
  trade_onchain_id?: string;
  transaction_hash?: string; // EVM
}

export interface RecordTransactionRequest {
  block_number?: number;
  escrow_id?: number;
  from_address?: string;
  metadata?: Record<string, unknown>;
  status?: 'PENDING' | 'SUCCESS' | 'FAILED';
  to_address?: string;
  trade_id: number;
  transaction_hash?: string;
  transaction_type:
    | 'CREATE_ESCROW'
    | 'FUND_ESCROW'
    | 'RELEASE_ESCROW'
    | 'CANCEL_ESCROW'
    | 'MARK_FIAT_PAID'
    | 'OPEN_DISPUTE'
    | 'RESPOND_DISPUTE'
    | 'RESOLVE_DISPUTE'
    | 'OTHER';
}

export interface OfferFilters {
  owner?: 'me';
  token?: string;
  type?: 'BUY' | 'SELL';
}

export interface TransactionFilters {
  limit?: number;
  offset?: number;
  type?: string;
}

// ============================================================================
// API CLIENT CLASS
// ============================================================================

export class YapBayApiClient {
  private readonly baseUrl: string;
  private token: string | null = null;
  private currentNetworkId: number | null = null;

  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  // ============================================================================
  // AUTHENTICATION & CONFIGURATION
  // ============================================================================

  /**
   * Set the JWT authentication token
   */
  setAuthToken(token: string): void {
    this.token = token;
  }

  /**
   * Clear the authentication token
   */
  clearAuthToken(): void {
    this.token = null;
  }

  /**
   * Set the current network context
   */
  setNetwork(networkId: number): void {
    this.currentNetworkId = networkId;
  }

  /**
   * Get the current network context
   */
  getCurrentNetwork(): number | null {
    return this.currentNetworkId;
  }

  // ============================================================================
  // HTTP CLIENT
  // ============================================================================

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    if (this.currentNetworkId) {
      headers['X-Network-ID'] = this.currentNetworkId.toString();
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new ApiError(data.error || 'Request failed', response.status, data);
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(error instanceof Error ? error.message : 'Network error', 0, null);
    }
  }

  private async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  private async post<T>(endpoint: string, data?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  private async put<T>(endpoint: string, data?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  private async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  // ============================================================================
  // ACCOUNTS
  // ============================================================================

  /**
   * Create a new account
   */
  async createAccount(data: CreateAccountRequest): Promise<ApiResponse<{ id: number }>> {
    return this.post<{ id: number }>('/accounts', data);
  }

  /**
   * Get the authenticated user's account details
   */
  async getMyAccount(): Promise<ApiResponse<Account>> {
    return this.get<Account>('/accounts/me');
  }

  /**
   * Get account details by ID (public view)
   */
  async getAccount(id: number): Promise<ApiResponse<PublicAccount>> {
    return this.get<PublicAccount>(`/accounts/${id}`);
  }

  /**
   * Update account information
   */
  async updateAccount(
    id: number,
    data: UpdateAccountRequest,
  ): Promise<ApiResponse<{ id: number }>> {
    return this.put<{ id: number }>(`/accounts/${id}`, data);
  }

  // ============================================================================
  // OFFERS
  // ============================================================================

  /**
   * Create a new offer
   */
  async createOffer(
    data: CreateOfferRequest,
  ): Promise<ApiResponse<{ network: string; offer: Offer }>> {
    return this.post<{ network: string; offer: Offer }>('/offers', data);
  }

  /**
   * Get all offers with optional filtering
   */
  async getOffers(filters?: OfferFilters): Promise<ApiResponse<Offer[]>> {
    const params = new URLSearchParams();
    if (filters?.type) {
      params.append('type', filters.type);
    }
    if (filters?.token) {
      params.append('token', filters.token);
    }
    if (filters?.owner) {
      params.append('owner', filters.owner);
    }

    const queryString = params.toString();
    const endpoint = queryString ? `/offers?${queryString}` : '/offers';
    return this.get<Offer[]>(endpoint);
  }

  /**
   * Get a specific offer by ID
   */
  async getOffer(id: number): Promise<ApiResponse<Offer>> {
    return this.get<Offer>(`/offers/${id}`);
  }

  /**
   * Update an offer
   */
  async updateOffer(
    id: number,
    data: UpdateOfferRequest,
  ): Promise<ApiResponse<{ network: string; offer: Offer }>> {
    return this.put<{ network: string; offer: Offer }>(`/offers/${id}`, data);
  }

  /**
   * Delete an offer
   */
  async deleteOffer(id: number): Promise<ApiResponse<{ message: string }>> {
    return this.delete<{ message: string }>(`/offers/${id}`);
  }

  // ============================================================================
  // TRADES
  // ============================================================================

  /**
   * Create a new trade
   */
  async createTrade(
    data: CreateTradeRequest,
  ): Promise<ApiResponse<{ network: string; trade: Trade }>> {
    return this.post<{ network: string; trade: Trade }>('/trades', data);
  }

  /**
   * Get the authenticated user's trades
   */
  async getMyTrades(): Promise<ApiResponse<Trade[]>> {
    return this.get<Trade[]>('/trades/my');
  }

  /**
   * Get a specific trade by ID
   */
  async getTrade(id: number): Promise<ApiResponse<Trade>> {
    return this.get<Trade>(`/trades/${id}`);
  }

  /**
   * Update a trade
   */
  async updateTrade(id: number, data: UpdateTradeRequest): Promise<ApiResponse<{ id: number }>> {
    return this.put<{ id: number }>(`/trades/${id}`, data);
  }

  // ============================================================================
  // ESCROWS
  // ============================================================================

  /**
   * Record an escrow creation
   */
  async recordEscrow(data: RecordEscrowRequest): Promise<
    ApiResponse<{
      success: boolean;
      escrowId: number;
      escrowDbId: number;
      txHash: string;
      networkFamily: string;
      blockExplorerUrl: string;
    }>
  > {
    return this.post('/escrows/record', data);
  }

  /**
   * Get the authenticated user's escrows
   */
  async getMyEscrows(): Promise<ApiResponse<Escrow[]>> {
    return this.get<Escrow[]>('/escrows/my');
  }

  // ============================================================================
  // TRANSACTIONS
  // ============================================================================

  /**
   * Record a transaction
   */
  async recordTransaction(data: RecordTransactionRequest): Promise<
    ApiResponse<{
      success: boolean;
      transactionId: number;
      txHash: string;
      blockNumber?: number;
    }>
  > {
    return this.post('/transactions', data);
  }

  /**
   * Get all transactions for a specific trade
   */
  async getTradeTransactions(tradeId: number, type?: string): Promise<ApiResponse<Transaction[]>> {
    const params = new URLSearchParams();
    if (type) {
      params.append('type', type);
    }

    const queryString = params.toString();
    const endpoint = queryString
      ? `/transactions/trade/${tradeId}?${queryString}`
      : `/transactions/trade/${tradeId}`;
    return this.get<Transaction[]>(endpoint);
  }

  /**
   * Get the authenticated user's transactions
   */
  async getUserTransactions(filters?: TransactionFilters): Promise<ApiResponse<Transaction[]>> {
    const params = new URLSearchParams();
    if (filters?.type) {
      params.append('type', filters.type);
    }
    if (filters?.limit) {
      params.append('limit', filters.limit.toString());
    }
    if (filters?.offset) {
      params.append('offset', filters.offset.toString());
    }

    const queryString = params.toString();
    const endpoint = queryString ? `/transactions/user?${queryString}` : '/transactions/user';
    return this.get<Transaction[]>(endpoint);
  }

  // ============================================================================
  // PUBLIC DATA
  // ============================================================================

  /**
   * Get cryptocurrency prices
   */
  async getPrices(): Promise<ApiResponse<{ USDC: PriceData }>> {
    return this.get<{ USDC: PriceData }>('/prices');
  }

  /**
   * Get system health status
   */
  async getHealthStatus(): Promise<ApiResponse<HealthStatus>> {
    return this.get<HealthStatus>('/health');
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Check if the client is authenticated
   */
  isAuthenticated(): boolean {
    return this.token !== null;
  }

  /**
   * Get the current base URL
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

export class ApiError extends Error {
  public status: number;
  public data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Create a new API client instance
 */
export function createApiClient(baseUrl?: string): YapBayApiClient {
  return new YapBayApiClient(baseUrl);
}

/**
 * Check if an error is an API error
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

// ============================================================================
// DEFAULT EXPORT
// ============================================================================

export default YapBayApiClient;
