import type { Address, ChainId, Hex, PreparedCall } from '@blocky/shared';

/**
 * The vendor boundary.
 *
 * Privy (auth + embedded signer) and ZeroDev (Kernel smart account, EIP-7702
 * delegation, session keys) sit behind these interfaces. Nothing outside this
 * package imports either SDK directly.
 *
 * This is not architecture astronautics. We are betting a wallet on two
 * venture-funded companies whose pricing and terms we do not control, and one
 * of which has already been acquired. The cost of this seam is a day; the cost
 * of not having it is a rewrite under time pressure.
 */

/* -------------------------------------------------------------------------- */
/*  Signing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Something that can sign on the user's behalf.
 *
 * Two implementations exist and the difference matters enormously:
 *
 *  - the *device* signer, gated behind Face ID, which the user controls; and
 *  - a *session key*, which the agent controls within on-chain limits.
 *
 * They are deliberately the same shape so calling code cannot accidentally
 * depend on which one it has — the policy engine decides which is used, not the
 * call site.
 */
export interface SignerProvider {
  readonly kind: 'device' | 'session';
  getAddress(): Promise<Address>;
  signMessage(message: string): Promise<Hex>;
  /** Sign a batch of calls as a single user operation. */
  signCalls(chainId: ChainId, calls: readonly PreparedCall[]): Promise<Hex>;
}

/* -------------------------------------------------------------------------- */
/*  Accounts                                                                   */
/* -------------------------------------------------------------------------- */

export interface SmartAccount {
  /**
   * The user's address.
   *
   * With EIP-7702 this is a plain EOA address that has delegated to Kernel, so
   * it is the same on every chain and exchanges can deposit to it directly.
   * That is the main reason we chose 7702 over a 4337 counterfactual address,
   * where "send from Coinbase to your wallet" silently fails until deployment.
   */
  address: Address;
  /** Whether the 7702 delegation is in place on a given chain. */
  isDelegated(chainId: ChainId): Promise<boolean>;
}

export interface ExecutionReceipt {
  hash: Hex;
  chainId: ChainId;
  status: 'success' | 'reverted';
  /** Actual fee charged, in USD, for reconciliation against the quote. */
  actualFeeUsd: string | null;
}

export interface SmartAccountProvider {
  getAccount(): Promise<SmartAccount>;
  /** Install the 7702 delegation if it is not already present. */
  ensureDelegated(chainId: ChainId): Promise<void>;
  /** Submit a signed batch and wait for inclusion. */
  execute(
    chainId: ChainId,
    calls: readonly PreparedCall[],
    signer: SignerProvider,
  ): Promise<ExecutionReceipt>;
  /** Dry-run without broadcasting. Never skip this before an execute. */
  simulate(
    chainId: ChainId,
    calls: readonly PreparedCall[],
  ): Promise<{ status: 'success' | 'reverted'; revertReason: string | null }>;
}
