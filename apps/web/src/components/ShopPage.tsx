// Flames shop (lobby page #shop, and #shop-paid after the Stripe return): balance, packs + the required consent tick,
// what Flames buy, purchase history (no self-service refund: support only). Prices are net, VAT by country is shown before paying. Page frame copied from AllWorlds. The server owns every
// rule and price (lobby catalogue); this screen only shows the answer. Desktop: two columns, fits 1440x900 without
// scrolling; phone: stacked, the page scrolls.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ShopFromId, ShopItemDto, ShopPremiumWorldDto, ShopResponse } from '@clanfire/engine';
import { ApiRequestError, api, errorMessage } from '../api.ts';
import { Icon } from '../art/Icon.tsx';
import {
  SETTLED_TEXT,
  buyBlocker,
  canBuy,
  countryOptions,
  disputeBannerText,
  flamesLabel,
  formatEur,
  isStripeCheckoutUrl,
  lockedNote,
  minorRemainingCents,
  minorUsedText,
  needsCountry,
  newRequestId,
  packChargeCents,
  packPrice,
  openDisputes,
  packBonusPercent,
  payLabel,
  premiumButtonLabel,
  premiumStatus,
  shopFromOf,
  purchaseStatusLabel,
  purchaseStatusTone,
  purchaseTitle,
  purchaseVatLine,
  refundedNote,
  rememberCountry,
  rememberedCountry,
  shopDate,
  shortfallText,
  showSettled,
  spendConfirmLines,
} from '../shop.ts';
import './lobby-phone.css';
import './shop.css';

/** After Stripe: re-fetch every 2 s for up to 20 s while the webhook credits the Flames. */
const PAID_POLL_MS = 2000;
const PAID_POLL_MAX = 10;

export function ShopPage({ paid, onBack, onSignedOut }: { paid: boolean; onBack: () => void; onSignedOut: () => void }) {
  const [shop, setShop] = useState<ShopResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [packId, setPackId] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [parentConsent, setParentConsent] = useState(false);
  const [pendingSpend, setPendingSpend] = useState<{ item: ShopItemDto; world?: ShopPremiumWorldDto; key: string } | null>(null);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const countryRef = useRef<string | null>(null);
  const fromRef = useRef<ShopFromId | null>(shopFromOf(typeof window === 'undefined' ? '' : window.location.search));
  const [notice, setNotice] = useState<string | null>(null);
  const [polling, setPolling] = useState(paid);
  const signedOutRef = useRef(onSignedOut);
  signedOutRef.current = onSignedOut;

  const fail = useCallback((e: unknown): string => {
    if (e instanceof ApiRequestError && e.status === 401) signedOutRef.current();
    return errorMessage(e);
  }, []);

  /** `country` = the player just chose one; otherwise the choice made earlier (remembered in this browser) is sent. */
  const load = useCallback(async (country?: string): Promise<ShopResponse | null> => {
    try {
      if (country) countryRef.current = country;
      else if (countryRef.current === null) countryRef.current = rememberedCountry(typeof localStorage === 'undefined' ? null : localStorage);
      // Where the shop was opened from (a world link adds ?from=); only the first load of the visit says it (the shop_open statistic).
      const r = await api.lobbyShop(countryRef.current, fromRef.current ?? undefined);
      fromRef.current = null;
      setShop(r);
      setLoadError(null);
      setPackId((cur) => (cur !== null && r.packs.some((p) => p.id === cur) ? cur : (r.packs[0]?.id ?? null)));
      return r;
    } catch (e) {
      setLoadError(fail(e));
      return null;
    }
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);
  // The "?from=" of a world's link is used up by the first load; take it out of the address so a later visit inside the lobby counts as the lobby.
  useEffect(() => {
    try {
      if (window.location.search) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash);
    } catch {
      // a browser that refuses is fine: only the statistic would name the wrong place
    }
  }, []);

  // The Stripe return: the webhook credits the Flames a moment later.
  useEffect(() => {
    if (!paid) return;
    setPolling(true);
    let n = 0;
    let first: number | null = null;
    const timer = window.setInterval(() => {
      n += 1;
      void load().then((r) => {
        if (r && first === null) first = r.balance;
        else if (r && first !== null && r.balance !== first) {
          window.clearInterval(timer);
          setPolling(false);
        }
      });
      if (n >= PAID_POLL_MAX) {
        window.clearInterval(timer);
        setPolling(false);
      }
    }, PAID_POLL_MS);
    return () => window.clearInterval(timer);
  }, [paid, load]);

  /** Both Stripe redirects (pack and settlement) go only to Stripe's checkout host. */
  function toStripe(url: string): boolean {
    if (!isStripeCheckoutUrl(url)) {
      setBuyError('The payment page address was not recognised, so nothing was sent. Please try again later.');
      return false;
    }
    window.location.assign(url);
    return true;
  }

  const gateOf = (sh: ShopResponse) => ({
    paymentsEnabled: sh.paymentsEnabled,
    paymentsBanned: sh.paymentsBanned,
    ageGroup: sh.ageGroup,
    packId,
    consent,
    parentConsent,
    minorRemainingCents: minorRemainingCents(sh.minorMonthlyCapCents, sh.minorBoughtThisMonthCents),
    packCents: (() => { const c = sh.packs.find((p) => p.id === packId); return c ? packChargeCents(c) : undefined; })(),
    needsCountry: needsCountry(sh.vat),
  });

  async function buy() {
    if (!shop || packId === null || buying) return;
    if (!canBuy(gateOf(shop))) return;
    setBuying(true);
    setBuyError(null);
    try {
      const r = await api.lobbyCheckout({ packId, consent: true, ...(shop.ageGroup === 'minor' ? { parentConsent: true } : {}), termsVersion: shop.termsVersion });
      if (!toStripe(r.url)) setBuying(false);
    } catch (e) {
      const msg = fail(e);
      setBuyError(e instanceof ApiRequestError && e.status === 409 && e.code === 'too_late' ? `${msg} Reloading the shop.` : msg);
      if (e instanceof ApiRequestError && e.status === 409) void load();
      setBuying(false);
    }
  }

  async function settle() {
    if (buying) return;
    setBuying(true);
    setBuyError(null);
    try {
      const r = await api.lobbyShopSettle();
      if (!toStripe(r.url)) setBuying(false);
    } catch (e) {
      setBuyError(fail(e));
      if (e instanceof ApiRequestError && e.status === 409) void load();
      setBuying(false);
    }
  }

  async function chooseAge(ageGroup: 'adult' | 'minor') {
    if (busy) return;
    setBusy('age');
    setBuyError(null);
    try {
      setShop(await api.lobbyShopAge({ ageGroup }));
    } catch (e) {
      setBuyError(fail(e));
      if (e instanceof ApiRequestError && e.status === 409) void load();
    }
    setBusy(null);
  }

  async function spend(item: ShopItemDto, worldId: string | undefined, key: string) {
    if (busy) return;
    setBusy(key);
    setPendingSpend(null);
    setActionError(null);
    setNotice(null);
    try {
      setShop(await api.lobbySpend({ itemId: item.id, ...(worldId ? { worldId } : {}), requestId: newRequestId() }));
      setNotice(item.kind === 'premium' ? `Premium added (${item.days ?? 30} days).` : `${item.name} is yours.`);
    } catch (e) {
      setActionError(fail(e));
    }
    setBusy(null);
  }

  async function chooseCountry(code: string) {
    rememberCountry(typeof localStorage === 'undefined' ? null : localStorage, code);
    setBuyError(null);
    await load(code);
  }

  const now = Date.now();
  const blocker = shop ? buyBlocker(shop) : null;
  const open = shop ? openDisputes(shop.disputes) : [];
  const owing = shop !== null && shop.openFeesCents > 0;
  const premium = shop?.items.find((i) => i.kind === 'premium');
  const looks = shop?.items.filter((i) => i.kind === 'look') ?? [];
  const chosen = shop?.packs.find((p) => p.id === packId) ?? null;

  return (
    <div className="aw shop">
      <header className="aw-bar">
        <div className="aw-bar-in shop-bar-in">
          <button type="button" className="lp-round" aria-label="Back" onClick={onBack}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
          </button>
          <h1 className="aw-title">Flames shop</h1>
        </div>
      </header>

      <main className="shop-main">
        {paid && (
          <p className="shop-paid" role="status">
            Payment received — your Flames arrive in a few seconds{polling ? '…' : '.'}
          </p>
        )}
        {!shop && !loadError && (
          <p className="home-note" role="status">
            Loading the shop…
          </p>
        )}
        {loadError && (
          <div className="home-note" role="alert">
            <p>{loadError}</p>
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              Try again
            </button>
          </div>
        )}

        {shop && (
          <>
            <section className="shop-balance" aria-label="Your balance">
              <span className="shop-flame" aria-hidden="true">
                <Icon name="flame" size={44} />
              </span>
              <div className="shop-balance-text">
                <span className="shop-balance-label">Your balance</span>
                <strong className={`shop-balance-num${shop.balance < 0 ? ' is-neg' : ''}`}>{flamesLabel(shop.balance)}</strong>
              </div>
              {blocker && (
                <p className="shop-warn" role="status">
                  {blocker}
                </p>
              )}
              {shop.locked && open.length === 0 && !owing && (
                <p className="shop-warn" role="status">
                  {lockedNote(shop.balance)}
                </p>
              )}
            </section>

            {open.map((d, i) => (
              <div key={d.purchaseId} className="shop-dispute" role="status">
                <p>{disputeBannerText(d, shop.openFeesCents)}</p>
                <span className="shop-dispute-btns">
                  {i === 0 && owing && (
                    <button type="button" className="btn btn-primary btn-small" disabled={buying || shop.paymentsEnabled === false} onClick={() => void settle()}>
                      Settle account
                    </button>
                  )}
                  <a className="btn btn-small" href="/legal/refunds">
                    Read what this means
                  </a>
                </span>
              </div>
            ))}
            {owing && open.length === 0 && (
              <div className="shop-dispute" role="status">
                <p>Fees from a bank dispute are open: {formatEur(shop.openFeesCents)}. Paid features are locked until they are paid.</p>
                <span className="shop-dispute-btns">
                  <button type="button" className="btn btn-primary btn-small" disabled={buying} onClick={() => void settle()}>
                    Settle account
                  </button>
                </span>
              </div>
            )}
            {showSettled(shop.disputes, shop.openFeesCents, shop.locked) && (
              <p className="shop-ok" role="status">
                {SETTLED_TEXT}
              </p>
            )}

            {(notice || actionError) && (
              <p className={actionError ? 'form-error' : 'shop-ok'} role={actionError ? 'alert' : 'status'}>
                {actionError ?? notice}
              </p>
            )}

            <div className="shop-grid">
              <section className="shop-card" aria-labelledby="shop-buy-h">
                <h2 id="shop-buy-h" className="shop-h">
                  Buy Flames
                </h2>
                {shop.ageGroup === null ? (
                  <div className="shop-age">
                    <p>
                      <strong>Before your first purchase:</strong> how old are you? You can only answer this once.
                    </p>
                    <span className="shop-age-btns">
                      <button type="button" className="btn" disabled={busy !== null} onClick={() => void chooseAge('adult')}>
                        I am 18 or older
                      </button>
                      <button type="button" className="btn" disabled={busy !== null} onClick={() => void chooseAge('minor')}>
                        I am under 18
                      </button>
                    </span>
                  </div>
                ) : null}
                {shop.vat.mode === 'stripe_tax' && (
                  <label className="shop-country">
                    <span className="shop-country-label">Your country (for VAT)</span>
                    <select
                      className="shop-country-select"
                      value={shop.vat.country ?? ''}
                      onChange={(e) => void chooseCountry(e.target.value)}
                    >
                      {shop.vat.country === null && (
                        <option value="" disabled>
                          Choose your country…
                        </option>
                      )}
                      {countryOptions(shop.vatCountries).map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className={`shop-packs${shop.ageGroup === null ? ' is-off' : ''}`} role="radiogroup" aria-label="Flames packs">
                  {shop.packs.map((p) => {
                    const bonus = packBonusPercent(p, shop.packs);
                    const price = packPrice(p, shop.vat, shop.vatCountries);
                    const over = shop.ageGroup === 'minor' && packChargeCents(p) > minorRemainingCents(shop.minorMonthlyCapCents, shop.minorBoughtThisMonthCents);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={packId === p.id}
                        aria-label={`${flamesLabel(p.flames)}: ${price.spoken}`}
                        disabled={shop.ageGroup === null || over}
                        className={`shop-pack${packId === p.id ? ' is-on' : ''}`}
                        onClick={() => setPackId(p.id)}
                      >
                        <span className="shop-pack-flames">{p.flames.toLocaleString('en-US')}</span>
                        <span className="shop-pack-unit">Flames</span>
                        <span className="shop-pack-net" aria-hidden="true">
                          {price.net}
                        </span>
                        <span className="shop-pack-vat" aria-hidden="true">
                          {price.vatLine}
                        </span>
                        <span className="shop-pack-price" aria-hidden="true">
                          {price.total ? `= ${price.total}` : '\u00a0'}
                        </span>
                        <span className="shop-pack-bonus">{bonus > 0 ? `+${bonus}% Flames` : '\u00a0'}</span>
                      </button>
                    );
                  })}
                </div>
                {shop.ageGroup === 'minor' && <p className="shop-fine shop-minor">{minorUsedText(shop.minorBoughtThisMonthCents, shop.minorMonthlyCapCents)}</p>}
                <label className="shop-consent">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                  <span>{shop.consentText}</span>
                </label>
                <p className="shop-fine shop-note">
                  {shop.consentNote} <a href="/legal/refunds">Refund policy</a>
                </p>
                {shop.ageGroup === 'minor' && (
                  <label className="shop-consent">
                    <input type="checkbox" checked={parentConsent} onChange={(e) => setParentConsent(e.target.checked)} />
                    <span>{shop.parentConsentText}</span>
                  </label>
                )}
                <p className="shop-fine shop-accept">
                  By paying you accept the <a href="/legal/terms">Terms</a> and the <a href="/legal/refunds">Refund policy</a>. Payment is handled by Stripe; we never see your card details. Flames are an in-game currency, not money.
                </p>
                <button type="button" className="btn btn-primary shop-buy" disabled={buying || !canBuy(gateOf(shop))} onClick={() => void buy()}>
                  {buying ? 'Opening payment page…' : payLabel(chosen, shop.vat)}
                </button>
                {buyError && (
                  <p className="form-error" role="alert">
                    {buyError}
                  </p>
                )}
              </section>

              <section className="shop-card" aria-labelledby="shop-spend-h">
                <h2 id="shop-spend-h" className="shop-h">
                  Spend Flames
                </h2>
                {premium && (
                  <div className="shop-item">
                    <p className="shop-item-title">
                      <strong>Premium {premium.days ?? 30} days</strong>
                      <span>
                        {flamesLabel(premium.priceFlames)} <span className="shop-eur">({formatEur(premium.eurCents)} + VAT)</span>
                      </span>
                    </p>
                    <p className="shop-fine">Choose the world. Premium does not renew by itself.</p>
                    {shop.premiumWorlds.length === 0 ? (
                      <p className="shop-fine">No world sells Premium right now.</p>
                    ) : (
                      <ul className="shop-worlds">
                        {shop.premiumWorlds.map((w) => {
                          const short = shortfallText(shop.balance, premium.priceFlames);
                          return (
                            <li key={w.worldId} className="shop-world">
                              <span className="shop-world-text">
                                <span className="shop-world-name">{w.worldName}</span>
                                <span className={`shop-world-state${w.until > now ? ' is-on' : ''}`}>{premiumStatus(w, now)}</span>
                              </span>
                              <button
                                type="button"
                                className="btn btn-teal shop-world-btn"
                                disabled={busy !== null || shop.locked || short !== null}
                                onClick={() => setPendingSpend({ item: premium, world: w, key: `p-${w.worldId}` })}
                              >
                                {busy === `p-${w.worldId}` ? 'Adding…' : premiumButtonLabel(w, premium.days ?? 30, now)}
                              </button>
                              {short && !shop.locked && <span className="shop-need">{short}</span>}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}
                {looks.length > 0 && (
                  <div className="shop-item">
                    <h3 className="shop-sub">Looks</h3>
                    <ul className="shop-worlds">
                      {looks.map((l) => {
                        const short = shortfallText(shop.balance, l.priceFlames);
                        return (
                          <li key={l.id} className="shop-world">
                            <span className="shop-world-text">
                              <span className="shop-world-name">{l.name}</span>
                              <span className="shop-world-state">
                                {flamesLabel(l.priceFlames)} ({formatEur(l.eurCents)} + VAT)
                              </span>
                            </span>
                            <button type="button" className="btn btn-teal shop-world-btn" disabled={l.owned === true || busy !== null || shop.locked || short !== null} onClick={() => setPendingSpend({ item: l, key: `l-${l.id}` })}>
                              {l.owned ? 'Owned' : busy === `l-${l.id}` ? 'Buying…' : 'Get'}
                            </button>
                            {short && !l.owned && !shop.locked && <span className="shop-need">{short}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>
            </div>

            <section className="shop-card shop-history" aria-labelledby="shop-hist-h">
              <h2 id="shop-hist-h" className="shop-h">
                Purchase history
              </h2>
              {shop.purchases.length === 0 ? (
                <p className="shop-fine">No purchases yet.</p>
              ) : (
                <ul className="shop-rows">
                  {shop.purchases.map((p) => {
                    const note = refundedNote(p);
                    const vatLine = purchaseVatLine(p, shop.vatCountries);
                    return (
                      <li key={p.id} className="shop-row">
                        <span className="shop-row-date">
                          {shopDate(p.paidAt ?? p.createdAt)} · {p.receiptNo}
                        </span>
                        <span className="shop-row-pack">{purchaseTitle(p)}</span>
                        <span className="shop-row-eur">{formatEur(p.priceCents)}</span>
                        <span className="shop-row-status">
                          <span className={`tag shop-tag-${purchaseStatusTone(p.status)}`}>{purchaseStatusLabel(p.status)}</span>
                          {note && <span className="shop-fine">{note}</span>}
                        </span>
                        <span className="shop-row-vat shop-fine">{vatLine}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {pendingSpend && shop && (
          <SpendDialog
            item={pendingSpend.item}
            worldName={pendingSpend.world?.worldName}
            balance={shop.balance}
            onCancel={() => setPendingSpend(null)}
            onConfirm={() => void spend(pendingSpend.item, pendingSpend.world?.worldId, pendingSpend.key)}
          />
        )}

        <footer className="shop-foot">
          <p>Flames buy Premium and looks only — never troops, resources, protection or Renown.</p>
          <nav aria-label="Legal">
            <a href="/legal/terms">Terms</a>
            <a href="/legal/refunds">Refunds</a>
            <a href="/legal/privacy">Privacy</a>
          </nav>
        </footer>
      </main>
    </div>
  );
}

/** The spend confirmation (legal texts section 4): shown before any Flames are spent. */
function SpendDialog({ item, worldName, balance, onCancel, onConfirm }: { item: ShopItemDto; worldName: string | undefined; balance: number; onCancel: () => void; onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = spendConfirmLines(item, worldName, balance);
  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dlg.open) dlg.showModal();
    return () => {
      if (dlg.open) dlg.close();
      previous?.focus?.();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="confirm shop-dialog"
      aria-label="Confirm spending"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
    >
      <div className="confirm-body">
        <p className="shop-dialog-title">
          <strong>{t.title}</strong> · {t.price}
        </p>
        {t.body.map((line) => (
          <p key={line} className="shop-dialog-line">
            {line}
          </p>
        ))}
      </div>
      <div className="confirm-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {t.button}
        </button>
      </div>
    </dialog>
  );
}
