(() => {
  const runtimeConfig = window.MWC_RUNTIME_CONFIG || {};
  const storeConfig = window.MWC_STORE_CONFIG || { products: [], bundles: [], shippingFee: 0, freeShippingThreshold: 999999, supportEmail: '', analytics: {}, leadCapture: {} };
  const config = {
    ...storeConfig,
    ...runtimeConfig,
    analytics: {
      ...(storeConfig.analytics || {}),
      ...(runtimeConfig.analytics || {})
    },
    leadCapture: {
      ...(storeConfig.leadCapture || {}),
      ...(runtimeConfig.leadCapture || {})
    }
  };

  const productMap = new Map(config.products.map((product) => [product.id, product]));
  const analyticsConfig = config.analytics || {};
  const leadCaptureConfig = config.leadCapture || {};
  const CART_KEY = 'mwc_cart_v2';
  const ATTRIBUTION_KEY = analyticsConfig.attributionStorageKey || 'mwc_attribution_v1';
  const formatPrice = (value) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: config.currency || 'EUR' }).format(Number(value || 0));
  const loadCart = () => { try { const parsed = JSON.parse(localStorage.getItem(CART_KEY)); return Array.isArray(parsed) ? parsed.filter((item) => productMap.has(item.id) && item.quantity > 0) : []; } catch { return []; } };
  const saveCart = (nextCart) => localStorage.setItem(CART_KEY, JSON.stringify(nextCart));
  const loadAttribution = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(ATTRIBUTION_KEY));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  };
  const saveAttribution = (value) => localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(value || {}));
  let cart = loadCart();

  const dataLayer = window.dataLayer = window.dataLayer || [];
  const debugAnalytics = (...args) => { if (analyticsConfig.debug) console.info('[MWC analytics]', ...args); };
  const getCartCount = () => cart.reduce((sum, item) => sum + item.quantity, 0);
  const getSubtotal = () => cart.reduce((sum, item) => sum + (productMap.get(item.id)?.price || 0) * item.quantity, 0);
  const getShipping = () => !cart.length ? 0 : (getSubtotal() >= (config.freeShippingThreshold ?? 999999) ? 0 : (config.shippingFee || 0));
  const getTotal = () => getSubtotal() + getShipping();
  const getProduct = (id) => productMap.get(id);
  const getCartItemsForTracking = () => cart.map((item) => {
    const product = getProduct(item.id);
    return {
      item_id: item.id,
      item_name: product?.name || item.id,
      price: Number(product?.price || 0),
      quantity: item.quantity,
      item_category: product?.badge || 'Produit'
    };
  });
  const getAllowedAttributionParams = () => Array.isArray(analyticsConfig.allowedAttributionParams) && analyticsConfig.allowedAttributionParams.length
    ? analyticsConfig.allowedAttributionParams
    : ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  const sanitizeAttribution = (source) => Object.fromEntries(
    Object.entries(source || {}).filter(([, value]) => typeof value === 'string' && value.trim()).map(([key, value]) => [key, value.trim().slice(0, 160)])
  );
  const normalizeReferrer = (value) => {
    if (!value) return '';
    try {
      const url = new URL(value);
      return `${url.hostname}${url.pathname}`.slice(0, 160);
    } catch {
      return String(value).slice(0, 160);
    }
  };
  const getAttributionSnapshot = () => {
    const params = new URLSearchParams(window.location.search);
    const allowedKeys = getAllowedAttributionParams();
    const captured = {};
    allowedKeys.forEach((key) => {
      const value = params.get(key);
      if (value) captured[key] = value;
    });
    const currentPath = `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 200);
    if (document.referrer) captured.referrer = normalizeReferrer(document.referrer);
    captured.landing_path = currentPath;
    captured.captured_at = new Date().toISOString();
    return sanitizeAttribution(captured);
  };
  const mergeAttribution = () => {
    const stored = loadAttribution();
    const snapshot = getAttributionSnapshot();
    const hasCampaignContext = Object.keys(snapshot).some((key) => key !== 'captured_at');
    if (!hasCampaignContext) return stored;
    const firstTouch = stored.firstTouch && Object.keys(stored.firstTouch || {}).length ? stored.firstTouch : snapshot;
    const merged = {
      firstTouch,
      lastTouch: snapshot,
      updatedAt: new Date().toISOString()
    };
    saveAttribution(merged);
    return merged;
  };
  let attribution = mergeAttribution();
  const getAttributionSummary = () => {
    const firstTouch = attribution.firstTouch || {};
    const lastTouch = attribution.lastTouch || {};
    return {
      first_source: firstTouch.utm_source || firstTouch.referrer || '',
      first_campaign: firstTouch.utm_campaign || '',
      last_source: lastTouch.utm_source || lastTouch.referrer || '',
      last_campaign: lastTouch.utm_campaign || '',
      landing_path: firstTouch.landing_path || lastTouch.landing_path || '',
      last_touch_path: lastTouch.landing_path || '',
      gclid: lastTouch.gclid || firstTouch.gclid || '',
      fbclid: lastTouch.fbclid || firstTouch.fbclid || ''
    };
  };
  const getAttributionText = () => {
    const summary = getAttributionSummary();
    const entries = [
      summary.first_source ? `1re source: ${summary.first_source}` : '',
      summary.first_campaign ? `1re campagne: ${summary.first_campaign}` : '',
      summary.last_source ? `Dernière source: ${summary.last_source}` : '',
      summary.last_campaign ? `Dernière campagne: ${summary.last_campaign}` : '',
      summary.landing_path ? `Landing: ${summary.landing_path}` : ''
    ].filter(Boolean);
    return entries.length ? entries.join(' • ') : 'Trafic direct / non attribué';
  };

  const track = (eventName, payload = {}) => {
    const attributionSummary = getAttributionSummary();
    const eventPayload = {
      event: eventName,
      ecommerce: {
        currency: config.currency || 'EUR',
        value: Number(getTotal().toFixed(2)),
        items: getCartItemsForTracking()
      },
      marketing: attributionSummary,
      page_path: window.location.pathname || '/',
      ...payload
    };
    dataLayer.push(eventPayload);
    debugAnalytics(eventName, eventPayload);

    if (typeof window.gtag === 'function') {
      try { window.gtag('event', eventName, eventPayload); } catch (error) { debugAnalytics('gtag_error', error?.message || error); }
    }

    if (typeof window.fbq === 'function') {
      try {
        const map = {
          add_to_cart: 'AddToCart',
          begin_checkout: 'InitiateCheckout',
          purchase_intent: 'InitiateCheckout',
          view_item_list: 'ViewContent',
          lead_capture_submitted: 'Lead'
        };
        const pixelEvent = map[eventName];
        if (pixelEvent) {
          window.fbq('track', pixelEvent, {
            content_name: payload.item_name || document.title,
            content_ids: getCartItemsForTracking().map((item) => item.item_id),
            content_type: 'product',
            currency: config.currency || 'EUR',
            value: Number(getTotal().toFixed(2))
          });
        }
      } catch (error) { debugAnalytics('fbq_error', error?.message || error); }
    }

    if (window.ttq && typeof window.ttq.track === 'function') {
      try {
        const map = {
          add_to_cart: 'AddToCart',
          begin_checkout: 'InitiateCheckout',
          purchase_intent: 'InitiateCheckout',
          view_item_list: 'ViewContent',
          lead_capture_submitted: 'SubmitForm'
        };
        const ttEvent = map[eventName];
        if (ttEvent) {
          window.ttq.track(ttEvent, {
            content_name: payload.item_name || document.title,
            content_id: payload.item_id || getCartItemsForTracking()[0]?.item_id || '',
            content_type: 'product',
            currency: config.currency || 'EUR',
            value: Number(getTotal().toFixed(2))
          });
        }
      } catch (error) { debugAnalytics('ttq_error', error?.message || error); }
    }
  };

  const loadGtag = (measurementId) => {
    if (!measurementId || document.querySelector('[data-mwc-ga]')) return;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    script.dataset.mwcGa = 'true';
    document.head.appendChild(script);
    window.gtag = window.gtag || function(){ dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', measurementId);
  };

  const loadMetaPixel = (pixelId) => {
    if (!pixelId || document.querySelector('[data-mwc-meta-pixel]')) return;
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;t.dataset.mwcMetaPixel='true';s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', pixelId);
    window.fbq('track', 'PageView');
  };

  const loadTikTokPixel = (pixelId) => {
    if (!pixelId || document.querySelector('[data-mwc-tiktok-pixel]')) return;
    window.TiktokAnalyticsObject = 'ttq';
    const ttq = window.ttq = window.ttq || [];
    ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie', 'holdConsent', 'revokeConsent', 'grantConsent'];
    ttq.setAndDefer = function(target, method) {
      target[method] = function() {
        target.push([method].concat(Array.prototype.slice.call(arguments, 0)));
      };
    };
    for (let i = 0; i < ttq.methods.length; i += 1) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function(instanceId) {
      const instance = ttq._i[instanceId] || [];
      for (let i = 0; i < ttq.methods.length; i += 1) ttq.setAndDefer(instance, ttq.methods[i]);
      return instance;
    };
    ttq.load = function(instanceId, options) {
      const src = 'https://analytics.tiktok.com/i18n/pixel/events.js';
      ttq._i = ttq._i || {};
      ttq._i[instanceId] = [];
      ttq._i[instanceId]._u = src;
      ttq._t = ttq._t || {};
      ttq._t[instanceId] = Date.now();
      ttq._o = ttq._o || {};
      ttq._o[instanceId] = options || {};
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.async = true;
      script.src = `${src}?sdkid=${encodeURIComponent(instanceId)}&lib=ttq`;
      script.dataset.mwcTiktokPixel = 'true';
      const firstScript = document.getElementsByTagName('script')[0];
      if (firstScript?.parentNode) firstScript.parentNode.insertBefore(script, firstScript);
      else document.head.appendChild(script);
    };
    ttq.load(pixelId);
    ttq.page();
  };

  loadGtag(analyticsConfig.gaMeasurementId);
  loadMetaPixel(analyticsConfig.metaPixelId);
  loadTikTokPixel(analyticsConfig.tiktokPixelId);

  const openCart = () => { const drawer = document.querySelector('[data-cart-drawer]'); if (!drawer) return; drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); };
  const closeCart = () => { const drawer = document.querySelector('[data-cart-drawer]'); if (!drawer) return; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); };
  const addProduct = (id, quantity = 1) => {
    const existing = cart.find((item) => item.id === id);
    if (existing) existing.quantity += quantity; else cart.push({ id, quantity });
    saveCart(cart);
    renderAll();
    const product = getProduct(id);
    track('add_to_cart', { item_id: id, item_name: product?.name || id, added_quantity: quantity });
  };
  const addBundle = (bundleId) => {
    const bundle = (config.bundles || []).find((entry) => entry.id === bundleId);
    if (!bundle) return;
    bundle.items.forEach((id) => {
      const existing = cart.find((item) => item.id === id);
      if (existing) existing.quantity += 1; else cart.push({ id, quantity: 1 });
    });
    saveCart(cart);
    renderAll();
    openCart();
    track('add_to_cart', { bundle_id: bundleId, bundle_name: bundle.name });
  };
  const updateQuantity = (id, delta) => {
    const item = cart.find((entry) => entry.id === id);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) cart = cart.filter((entry) => entry.id !== id);
    saveCart(cart);
    renderAll();
    track('cart_updated', { item_id: id, delta, cart_count: getCartCount() });
  };
  const clearCart = () => { cart = []; saveCart(cart); renderAll(); track('cart_cleared', { cart_count: 0 }); };
  const renderCounts = () => document.querySelectorAll('[data-cart-count]').forEach((node) => { node.textContent = String(getCartCount()); });
  const renderShippingInfo = () => {
    const countries = Array.isArray(config.servedCountries) ? config.servedCountries : [];
    const windows = Array.isArray(config.shippingWindows) ? config.shippingWindows : [];
    document.querySelectorAll('[data-served-countries]').forEach((node) => {
      node.innerHTML = countries.map((country) => `<li>${country}</li>`).join('');
    });
    document.querySelectorAll('[data-shipping-windows]').forEach((node) => {
      node.innerHTML = windows.map((entry) => `<li><strong>${entry.country}</strong><span>${entry.eta}</span></li>`).join('');
    });
    document.querySelectorAll('[data-shipping-method-label]').forEach((node) => {
      node.textContent = config.shippingMethodLabel || 'Livraison standard suivie';
    });
    document.querySelectorAll('[data-support-window]').forEach((node) => {
      node.textContent = config.supportResponseWindow || '24 à 48 h ouvrées';
    });
  };
  const renderCartItems = () => {
    const targets = document.querySelectorAll('[data-cart-items], [data-checkout-items]');
    targets.forEach((target) => {
      if (!cart.length) { target.innerHTML = '<div class="empty-state">Votre panier est vide. Retournez sur <a class="helper-link" href="/">la home MWC</a> pour ajouter des produits.</div>'; return; }
      target.innerHTML = cart.map((item) => {
        const product = getProduct(item.id);
        if (!product) return '';
        const itemClass = target.hasAttribute('data-checkout-items') ? 'summary-item' : 'cart-item';
        return `<article class="${itemClass}"><img src="${product.image}" alt="${product.name}"><div class="item-meta"><strong>${product.name}</strong><p>${product.description}</p><span>${formatPrice(product.price)} × ${item.quantity}</span><div class="qty-row"><button type="button" data-dec-item="${product.id}">−</button><strong>${item.quantity}</strong><button type="button" data-inc-item="${product.id}">+</button></div></div></article>`;
      }).join('');
    });
  };
  const getCheckoutDestination = () => {
    const productSpecific = cart.length === 1 ? getProduct(cart[0].id)?.checkoutUrl : '';
    const bundleSpecific = cart.length > 1 ? findMatchingBundleCheckout() : '';
    return productSpecific || bundleSpecific || config.checkoutUrl || '';
  };
  const getCheckoutExperience = () => {
    if (!cart.length) {
      return {
        modeLabel: config.checkoutModeLabel || 'Checkout externe configurable',
        notice: 'Ajoutez un produit pour afficher le mode de finalisation disponible.',
        actionLabel: 'Accéder au paiement sécurisé'
      };
    }
    if (cart.length === 1 && getProduct(cart[0].id)?.checkoutUrl) {
      return {
        modeLabel: 'Stripe Checkout sécurisé pour ce produit',
        notice: 'Cette sélection part directement vers Stripe Checkout après validation du formulaire.',
        actionLabel: 'Accéder au paiement sécurisé'
      };
    }
    if (findMatchingBundleCheckout()) {
      return {
        modeLabel: 'Stripe Checkout sécurisé pour le bundle sélectionné',
        notice: 'Le bundle actuel possède un lien Stripe Checkout dédié.',
        actionLabel: 'Accéder au paiement sécurisé'
      };
    }
    return {
      modeLabel: 'Finalisation assistée par email pour cette combinaison',
      notice: 'Cette combinaison multi-produits n’a pas encore de lien Stripe unique. Le formulaire prépare alors une demande de finalisation assistée par email.',
      actionLabel: 'Préparer la demande de finalisation'
    };
  };
  const renderAttribution = () => {
    const text = getAttributionText();
    document.querySelectorAll('[data-attribution-summary]').forEach((node) => {
      node.textContent = text;
    });
  };
  const renderSummary = () => {
    document.querySelectorAll('[data-cart-subtotal]').forEach((node) => node.textContent = formatPrice(getSubtotal()));
    document.querySelectorAll('[data-cart-shipping]').forEach((node) => node.textContent = getShipping() === 0 ? 'Offerte' : formatPrice(getShipping()));
    document.querySelectorAll('[data-cart-total]').forEach((node) => node.textContent = formatPrice(getTotal()));
    const experience = getCheckoutExperience();
    const modeNode = document.querySelector('[data-checkout-mode]');
    if (modeNode) modeNode.textContent = experience.modeLabel;
    const noticeNode = document.querySelector('[data-checkout-notice]');
    if (noticeNode) noticeNode.textContent = experience.notice;
    const submitButton = document.querySelector('[data-checkout-submit]');
    if (submitButton) submitButton.textContent = experience.actionLabel;
    renderAttribution();
  };
  const renderProductGrid = () => {
    const grid = document.querySelector('[data-product-grid]');
    if (!grid) return;
    grid.innerHTML = config.products.map((product) => {
      const savingsPercent = product.compareAt ? Math.round((1 - (product.price / product.compareAt)) * 100) : 0;
      const benefits = Array.isArray(product.benefits) ? product.benefits.slice(0, 3) : [];
      const proofPills = [
        product.checkoutUrl ? 'Checkout direct' : '',
        savingsPercent > 0 ? `Économie ${savingsPercent} %` : '',
        product.price >= (config.freeShippingThreshold || Infinity) ? 'Livraison offerte' : ''
      ].filter(Boolean);
      return `
      <article class="product-card" data-product-card="${product.id}">
        <img loading="lazy" src="${product.image}" alt="${product.name}">
        <div class="product-body">
          <div class="product-meta"><div><strong>${product.name}</strong></div><span class="product-tag">${product.badge}</span></div>
          <p class="product-desc">${product.description}</p>
          ${benefits.length ? `<ul class="product-benefits">${benefits.map((benefit) => `<li>${benefit}</li>`).join('')}</ul>` : ''}
          ${proofPills.length ? `<div class="product-proof-row">${proofPills.map((pill) => `<span class="product-proof-pill">${pill}</span>`).join('')}</div>` : ''}
          <div class="price-stack"><strong>${formatPrice(product.price)}</strong><span>${product.compareAt ? `au lieu de ${formatPrice(product.compareAt)}` : ''}</span></div>
          <div class="card-actions"><button class="btn btn-primary" type="button" data-add-product="${product.id}">Ajouter</button><a class="btn btn-secondary" href="/pages/checkout.html">Checkout</a></div>
        </div>
      </article>`;
    }).join('');
  };
  const bindGlobalEvents = () => {
    document.querySelectorAll('[data-scroll]').forEach((element) => {
      element.addEventListener('click', (event) => {
        const target = document.querySelector(element.getAttribute('href'));
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    document.addEventListener('click', (event) => {
      const addButton = event.target.closest('[data-add-product]');
      const bundleButton = event.target.closest('[data-add-bundle]');
      const openButton = event.target.closest('[data-open-cart]');
      const closeButton = event.target.closest('[data-close-cart]');
      const clearButton = event.target.closest('[data-clear-cart]');
      const incButton = event.target.closest('[data-inc-item]');
      const decButton = event.target.closest('[data-dec-item]');
      if (addButton) { addProduct(addButton.dataset.addProduct, 1); openCart(); }
      if (bundleButton) addBundle(bundleButton.dataset.addBundle);
      if (openButton) openCart();
      if (closeButton) closeCart();
      if (clearButton) clearCart();
      if (incButton) updateQuantity(incButton.dataset.incItem, 1);
      if (decButton) updateQuantity(decButton.dataset.decItem, -1);
    });
  };
  const findMatchingBundleCheckout = () => {
    const normalizedCart = [...cart].sort((a, b) => a.id.localeCompare(b.id)).map((item) => `${item.id}:${item.quantity}`).join('|');
    return (config.bundles || []).find((bundle) => {
      const counts = bundle.items.reduce((acc, id) => { acc[id] = (acc[id] || 0) + 1; return acc; }, {});
      const normalizedBundle = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])).map(([id, quantity]) => `${id}:${quantity}`).join('|');
      return normalizedBundle === normalizedCart && bundle.checkoutUrl;
    })?.checkoutUrl || '';
  };
  const buildCheckoutQuery = (customer) => {
    const query = new URLSearchParams({
      name: `${customer.firstName} ${customer.lastName}`.trim(),
      email: customer.email,
      phone: customer.phone || '',
      amount: getTotal().toFixed(2),
      items: cart.map((item) => `${getProduct(item.id)?.name} x${item.quantity}`).join(' | ')
    });
    Object.entries(getAttributionSummary()).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    if (customer.marketingConsent) query.set('marketing_consent', customer.marketingConsent);
    return query;
  };
  const redirectToExternalCheckout = (customer) => {
    const url = getCheckoutDestination();
    if (!url) return false;
    const query = buildCheckoutQuery(customer);
    track('purchase_intent', {
      checkout_url: url,
      customer_email_domain: (customer.email || '').split('@')[1] || '',
      marketing_opt_in: customer.marketingConsent === 'yes'
    });
    window.location.href = `${url}${url.includes('?') ? '&' : '?'}${query.toString()}`;
    return true;
  };
  const fallbackToEmail = (customer) => {
    const lines = [
      'Nouvelle commande MWC',
      '',
      `Client: ${customer.firstName} ${customer.lastName}`,
      `Email: ${customer.email}`,
      `Téléphone: ${customer.phone || 'n/a'}`,
      `Adresse: ${customer.address}, ${customer.postalCode} ${customer.city}, ${customer.country}`,
      `Marketing opt-in: ${customer.marketingConsent === 'yes' ? 'oui' : 'non'}`,
      '',
      'Produits:',
      ...cart.map((item) => `- ${getProduct(item.id)?.name} x${item.quantity} — ${formatPrice((getProduct(item.id)?.price || 0) * item.quantity)}`),
      '',
      `Sous-total: ${formatPrice(getSubtotal())}`,
      `Livraison: ${getShipping() === 0 ? 'Offerte' : formatPrice(getShipping())}`,
      `Total: ${formatPrice(getTotal())}`,
      '',
      `Attribution: ${getAttributionText()}`,
      `Notes: ${customer.notes || 'Aucune'}`
    ].join('\n');
    const mailto = `mailto:${encodeURIComponent(config.supportEmail)}?subject=${encodeURIComponent('Commande MWC à finaliser')}&body=${encodeURIComponent(lines)}`;
    track('checkout_assisted', { support_email: config.supportEmail, marketing_opt_in: customer.marketingConsent === 'yes' });
    window.location.href = mailto;
  };
  const buildLeadPayload = (formData) => ({
    email: formData.email || '',
    firstName: formData.firstName || '',
    interest: formData.interest || '',
    platform: formData.platform || '',
    notes: formData.notes || '',
    audience: leadCaptureConfig.audienceLabel || 'MWC prospects',
    incentive: leadCaptureConfig.incentiveLabel || 'checklist rangement + prochaines offres MWC',
    attribution: getAttributionSummary(),
    pagePath: window.location.pathname || '/',
    submittedAt: new Date().toISOString()
  });
  const setLeadStatus = (message, tone = 'neutral') => {
    document.querySelectorAll('[data-lead-status]').forEach((node) => {
      node.textContent = message;
      node.dataset.tone = tone;
    });
  };
  const submitLeadCapture = async (payload) => {
    const webhookUrl = leadCaptureConfig.webhookUrl || '';
    if (webhookUrl) {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Lead webhook error: ${response.status}`);
      }
      return { mode: 'webhook' };
    }

    const emailTarget = leadCaptureConfig.supportEmailFallback || config.supportEmail;
    if (!emailTarget) throw new Error('No lead capture route configured');
    const body = [
      'Nouveau lead MWC',
      '',
      `Email: ${payload.email}`,
      `Prénom: ${payload.firstName || 'n/a'}`,
      `Intérêt: ${payload.interest || 'n/a'}`,
      `Plateforme préférée: ${payload.platform || 'n/a'}`,
      `Notes: ${payload.notes || 'Aucune'}`,
      `Audience: ${payload.audience}`,
      `Attribution: ${getAttributionText()}`
    ].join('\n');
    window.location.href = `mailto:${encodeURIComponent(emailTarget)}?subject=${encodeURIComponent('Lead MWC à traiter')}&body=${encodeURIComponent(body)}`;
    return { mode: 'email' };
  };
  const bindLeadCapture = () => {
    if (!leadCaptureConfig.enabled) return;
    const form = document.querySelector('[data-lead-capture-form]');
    if (!form) return;
    form.addEventListener('focusin', () => {
      track('lead_capture_started', { page: document.body?.dataset.page || 'unknown' });
    }, { once: true });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      const payload = buildLeadPayload(data);
      setLeadStatus('Préparation de votre demande…');
      try {
        const result = await submitLeadCapture(payload);
        setLeadStatus(result.mode === 'webhook'
          ? 'Merci. Votre demande a été envoyée à MWC. Vous pourrez être recontacté(e) si une campagne / offre correspond à votre intérêt.'
          : 'Votre application email va s’ouvrir pour confirmer l’envoi à MWC.', 'success');
        track('lead_capture_submitted', { route: result.mode, interest: payload.interest || 'general' });
        form.reset();
      } catch (error) {
        debugAnalytics('lead_capture_error', error?.message || error);
        setLeadStatus('Impossible d’envoyer automatiquement la demande. Utilisez le contact support ou réessayez plus tard.', 'error');
        track('lead_capture_failed', { reason: error?.message || 'unknown' });
      }
    });
  };
  const bindCheckout = () => {
    const form = document.querySelector('[data-checkout-form]');
    if (!form) return;
    track('begin_checkout', { page: 'checkout' });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (!cart.length) { alert('Votre panier est vide.'); return; }
      const data = Object.fromEntries(new FormData(form).entries());
      const ok = redirectToExternalCheckout(data);
      if (!ok) fallbackToEmail(data);
    });
  };
  const renderAll = () => { renderCounts(); renderShippingInfo(); renderCartItems(); renderSummary(); renderProductGrid(); };

  bindGlobalEvents();
  bindLeadCapture();
  bindCheckout();
  renderAll();

  if (document.body?.dataset.page === 'home') {
    track('view_item_list', { page: 'home', item_list_name: 'catalogue_mwc_home' });
  }
})();
