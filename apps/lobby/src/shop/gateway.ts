// The payment provider behind an interface, plus the real Stripe implementation (plain fetch, no SDK).
// The secret key never appears in a log line, a thrown message or a response: errors carry only the HTTP status and Stripe's
// error type/code (never its free-text message, which can quote part of a key).

export interface CheckoutRequest {
  purchaseId: number;
  accountId: number;
  /** 'flames' = a pack; 'settle' = the player paying open dispute fees. */
  kind: 'flames' | 'settle';
  packId: string;
  flames: number;
  amountCents: number;
  successUrl: string;
  cancelUrl: string;
  /** Unix seconds; Stripe wants 30 minutes to 24 hours from the moment it receives the request. */
  expiresAtSec: number;
}

export interface PaymentGateway {
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  refund(paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<{ id: string }>;
  submitDisputeEvidence(disputeId: string, evidence: Record<string, string>): Promise<void>;
}

/** The provider said no, or could not be reached. The message is safe to log. */
export class PaymentError extends Error {}

export const STRIPE_API = 'https://api.stripe.com/v1';
/** Pinned: a Stripe account-wide upgrade must never change what this code gets back. */
export const STRIPE_VERSION = '2025-09-30.clover';
export const CHECKOUT_URL_PREFIX = 'https://checkout.stripe.com/';
export const STATEMENT_DESCRIPTOR_SUFFIX = 'CLANFIRE';

export interface StripeGatewayOptions {
  secretKey: string;
  /** Let Stripe Tax add VAT (STRIPE_TAX=1). */
  tax?: boolean;
  /** Test hook. Default: global fetch. */
  fetch?: typeof fetch;
  /** Per-request time limit, ms. */
  timeoutMs?: number;
}

export class StripeGateway implements PaymentGateway {
  private readonly secretKey: string;
  private readonly tax: boolean;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: StripeGatewayOptions) {
    this.secretKey = opts.secretKey;
    this.tax = opts.tax ?? false;
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private async post(path: string, params: URLSearchParams, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_VERSION,
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let res: Response;
    try {
      res = await this.fetchFn(`${STRIPE_API}${path}`, { method: 'POST', headers, body: params.toString(), signal: AbortSignal.timeout(this.timeoutMs) });
    } catch {
      throw new PaymentError(`Stripe ${path}: no answer (network error or timeout)`);
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // not JSON: handled below
    }
    if (!res.ok) {
      const e = (body as { error?: { type?: unknown; code?: unknown } } | null)?.error;
      const type = typeof e?.type === 'string' ? e.type.slice(0, 40) : 'unknown';
      const code = typeof e?.code === 'string' ? e.code.slice(0, 60) : '';
      throw new PaymentError(`Stripe ${path}: HTTP ${res.status} ${type}${code ? ` ${code}` : ''}`);
    }
    if (typeof body !== 'object' || body === null) throw new PaymentError(`Stripe ${path}: unreadable answer`);
    return body as Record<string, unknown>;
  }

  async createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }> {
    const p = new URLSearchParams();
    p.set('mode', 'payment');
    p.set('payment_method_types[0]', 'card');
    p.set('payment_method_options[card][request_three_d_secure]', 'any');
    p.set('payment_intent_data[statement_descriptor_suffix]', STATEMENT_DESCRIPTOR_SUFFIX);
    p.set('payment_intent_data[metadata][purchase_id]', String(req.purchaseId));
    p.set('line_items[0][quantity]', '1');
    p.set('line_items[0][price_data][currency]', 'eur');
    p.set('line_items[0][price_data][unit_amount]', String(req.amountCents));
    p.set('line_items[0][price_data][product_data][name]', req.kind === 'settle' ? 'Clanflame account settlement' : `${req.flames} Flames`);
    p.set('metadata[kind]', req.kind);
    p.set('client_reference_id', String(req.purchaseId));
    p.set('metadata[purchase_id]', String(req.purchaseId));
    p.set('metadata[account_id]', String(req.accountId));
    p.set('metadata[pack_id]', req.packId);
    p.set('expires_at', String(req.expiresAtSec));
    p.set('success_url', req.successUrl);
    p.set('cancel_url', req.cancelUrl);
    if (this.tax) p.set('automatic_tax[enabled]', 'true');
    const body = await this.post('/checkout/sessions', p, `checkout-${req.purchaseId}`);
    const id = body.id;
    const url = body.url;
    if (typeof id !== 'string' || typeof url !== 'string') throw new PaymentError('Stripe /checkout/sessions: answer without id or url');
    // Players are sent to this address: never to anything but Stripe's hosted page.
    if (!url.startsWith(CHECKOUT_URL_PREFIX)) throw new PaymentError('Stripe /checkout/sessions: unexpected checkout address');
    return { id, url };
  }

  async refund(paymentIntentId: string, amountCents: number, idempotencyKey: string): Promise<{ id: string }> {
    const p = new URLSearchParams();
    p.set('payment_intent', paymentIntentId);
    p.set('amount', String(amountCents));
    p.set('reason', 'requested_by_customer');
    const body = await this.post('/refunds', p, idempotencyKey);
    if (typeof body.id !== 'string') throw new PaymentError('Stripe /refunds: answer without id');
    return { id: body.id };
  }

  async submitDisputeEvidence(disputeId: string, evidence: Record<string, string>): Promise<void> {
    if (!/^[A-Za-z0-9_]{3,100}$/.test(disputeId)) throw new PaymentError('bad dispute id');
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(evidence)) p.set(`evidence[${k}]`, v);
    p.set('submit', 'true');
    await this.post(`/disputes/${disputeId}`, p, `dispute-${disputeId}`);
  }
}
