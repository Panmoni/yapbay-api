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
  method?: string;
  headers?: Record<string, string> | string[][];
  body?: string | null;
  mode?: string;
  credentials?: string;
  cache?: string;
  redirect?: string;
  referrer?: string;
  referrerPolicy?: string;
  integrity?: string;
  keepalive?: boolean;
  signal?: any;
  window?: any;
}

export interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: string;
  message?: string;
  network?: string;
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
  id: number;
  name: string;
  chainId: number;
  rpcUrl: string;
  wsUrl?: string;
  contractAddress?: string;
  programId?: string;
  usdcMint?: string;
  arbitratorAddress: string;
  isTestnet: boolean;
  isActive: boolean;
  networkFamily: 'evm' | 'solana';
  createdAt: Date;
  updatedAt: Date;
}

export interface Account {
  id: number;
  wallet_address: string;
  username: string;
  email: string;
  telegram_username?: string;
  telegram_id?: number;
  profile_photo_url?: string;
  phone_country_code?: string;
  phone_number?: string;
  available_from?: string;
  available_to?: string;
  timezone?: string;
  role: 'user' | 'admin';
  created_at: Date;
  updated_at: Date;
}

export interface PublicAccount {
  id: number;
  username: string;
  wallet_address: string;
  telegram_username?: string;
  telegram_id?: number;
  profile_photo_url?: string;
  available_from?: string;
  available_to?: string;
  timezone?: string;
  created_at: Date;
}

export interface Offer {
  id: number;
  creator_account_id: number;
  network_id: number;
  offer_type: 'BUY' | 'SELL';
  token: string;
  fiat_currency: string;
  min_amount: number;
  max_amount: number;
  total_available_amount: number;
  rate_adjustment: number;
  terms: string;
  escrow_deposit_time_limit: string;
  fiat_payment_time_limit: string;
  created_at: Date;
  updated_at: Date;
}

export interface Trade {
  id: number;
  leg1_offer_id: number;
  leg2_offer_id?: number;
  overall_status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
  from_fiat_currency: string;
  destination_fiat_currency: string;
  from_bank?: string;
  destination_bank?: string;
  leg1_state: 'CREATED' | 'FUNDED' | 'FIAT_PAID' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
  leg1_seller_account_id: number;
  leg1_buyer_account_id: number;
  leg1_crypto_token: string;
  leg1_crypto_amount: number;
  leg1_fiat_currency: string;
  leg1_fiat_amount?: number;
  leg1_escrow_deposit_deadline: Date;
  leg1_fiat_payment_deadline: Date;
  leg1_fiat_paid_at?: Date;
  leg1_released_at?: Date;
  leg1_cancelled_at?: Date;
  leg1_escrow_onchain_id?: number;
  network_id: number;
  created_at: Date;
  updated_at: Date;
}

export interface Escrow {
  id: number;
  trade_id: number;
  escrow_address: string;
  onchain_escrow_id: number;
  seller_address: string;
  buyer_address: string;
  arbitrator_address: string;
  token_type: string;
  amount: number;
  current_balance?: number;
  state:
    | 'CREATED'
    | 'FUNDED'
    | 'RELEASED'
    | 'CANCELLED'
    | 'AUTO_CANCELLED'
    | 'DISPUTED'
    | 'RESOLVED';
  sequential: boolean;
  sequential_escrow_address?: string;
  fiat_paid: boolean;
  counter: number;
  deposit_deadline?: Date;
  fiat_deadline?: Date;
  dispute_id?: number;
  completed_at?: Date;
  version?: string;
  network_family: 'evm' | 'solana';
  program_id?: string;
  escrow_pda?: string;
  escrow_token_account?: string;
  escrow_onchain_id?: string;
  trade_onchain_id?: string;
  network_id: number;
  created_at: Date;
  updated_at: Date;
}

export interface Transaction {
  id: number;
  transaction_hash?: string;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
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
  block_number?: number;
  sender_address?: string;
  receiver_or_contract_address?: string;
  gas_used?: number;
  error_message?: string;
  related_trade_id?: number;
  related_escrow_db_id?: number;
  network_id: number;
  created_at: Date;
}

export interface PriceData {
  [fiat: string]: {
    price: string;
    timestamp: number;
  };
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  userWallet: string;
  dbStatus: string;
  apiVersion: {
    version: string;
    gitCommitHash: string;
    gitCommitDate: string;
    gitBranch: string;
    buildDate: string;
    isDirty: boolean;
  };
  contractVersion: string;
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
  summary: {
    totalNetworks: number;
    activeNetworks: number;
    connectedNetworks: number;
    errorNetworks: number;
    evmNetworks: number;
    solanaNetworks: number;
  };
}

// Request interfaces
export interface CreateAccountRequest {
  wallet_address: string;
  username: string;
  email: string;
}

export interface UpdateAccountRequest {
  username?: string;
  email?: string;
  telegram_username?: string;
  telegram_id?: number;
  profile_photo_url?: string;
  phone_country_code?: string;
  phone_number?: string;
  available_from?: string;
  available_to?: string;
  timezone?: string;
}

export interface CreateOfferRequest {
  creator_account_id: number;
  offer_type: 'BUY' | 'SELL';
  token?: string;
  fiat_currency?: string;
  min_amount: number;
  max_amount?: number;
  total_available_amount?: number;
  rate_adjustment?: number;
  terms?: string;
  escrow_deposit_time_limit?: string;
  fiat_payment_time_limit?: string;
}

export interface UpdateOfferRequest {
  min_amount?: number;
  max_amount?: number;
  total_available_amount?: number;
  rate_adjustment?: number;
  terms?: string;
  escrow_deposit_time_limit?: string | { minutes: number };
  fiat_payment_time_limit?: string | { minutes: number };
  fiat_currency?: string;
  offer_type?: 'BUY' | 'SELL';
  token?: string;
}

export interface CreateTradeRequest {
  leg1_offer_id: number;
  leg2_offer_id?: number;
  leg1_crypto_amount?: number;
  leg1_fiat_amount?: number;
  from_fiat_currency?: string;
  destination_fiat_currency?: string;
  from_bank?: string;
  destination_bank?: string;
}

export interface UpdateTradeRequest {
  leg1_state?: 'CREATED' | 'FUNDED' | 'FIAT_PAID' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
  overall_status?: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
  fiat_paid?: boolean;
}

export interface RecordEscrowRequest {
  trade_id: number;
  transaction_hash?: string; // EVM
  signature?: string; // Solana
  escrow_id: number;
  seller: string;
  buyer: string;
  amount: number;
  sequential: boolean;
  sequential_escrow_address?: string;
  // Solana-specific fields
  program_id?: string;
  escrow_pda?: string;
  escrow_token_account?: string;
  trade_onchain_id?: string;
}

export interface RecordTransactionRequest {
  trade_id: number;
  escrow_id?: number;
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
  from_address?: string;
  to_address?: string;
  block_number?: number;
  metadata?: Record<string, unknown>;
  status?: 'PENDING' | 'SUCCESS' | 'FAILED';
}

export interface OfferFilters {
  type?: 'BUY' | 'SELL';
  token?: string;
  owner?: 'me';
}

export interface TransactionFilters {
  type?: string;
  limit?: number;
  offset?: number;
}

// ============================================================================
// API CLIENT CLASS
// ============================================================================

export class YapBayApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private currentNetworkId: number | null = null;

  constructor(baseUrl: string = 'http://localhost:3000') {
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
    data: UpdateAccountRequest
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
    data: CreateOfferRequest
  ): Promise<ApiResponse<{ network: string; offer: Offer }>> {
    return this.post<{ network: string; offer: Offer }>('/offers', data);
  }

  /**
   * Get all offers with optional filtering
   */
  async getOffers(filters?: OfferFilters): Promise<ApiResponse<Offer[]>> {
    const params = new URLSearchParams();
    if (filters?.type) params.append('type', filters.type);
    if (filters?.token) params.append('token', filters.token);
    if (filters?.owner) params.append('owner', filters.owner);

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
    data: UpdateOfferRequest
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
    data: CreateTradeRequest
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
    if (type) params.append('type', type);

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
    if (filters?.type) params.append('type', filters.type);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.offset) params.append('offset', filters.offset.toString());

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
