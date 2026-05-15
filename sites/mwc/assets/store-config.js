const mwcRuntimeConfig = window.MWC_RUNTIME_CONFIG || {};

window.MWC_STORE_CONFIG = {
  currency: 'EUR',
  supportEmail: 'forwriterinfo@gmail.com',
  supportResponseWindow: '24 à 48 h ouvrées',
  shippingFee: 4.90,
  freeShippingThreshold: 59,
  shippingMethodLabel: 'Livraison standard suivie',
  servedCountries: ['Australie', 'Canada', 'Allemagne', 'Pays-Bas', 'Suède'],
  shippingWindows: [
    { country: 'Australie', eta: '7 à 12 jours ouvrés' },
    { country: 'Canada', eta: '7 à 12 jours ouvrés' },
    { country: 'Allemagne', eta: '5 à 9 jours ouvrés' },
    { country: 'Pays-Bas', eta: '5 à 9 jours ouvrés' },
    { country: 'Suède', eta: '5 à 10 jours ouvrés' }
  ],
  checkoutMode: 'external_ready',
  checkoutModeLabel: 'Liens Stripe Checkout actifs par produit + bundle',
  stripePublishableKey: 'pk_live_51TPfb7BRYJSwXNgToHmdesmNFXxTJiMlbFDANSX5rrRb3ERXBKxIuSjqGazOsewldSLwl8p5nwrF9hK0hOYeontG00AINW3Uys',

  analytics: {
    gaMeasurementId: 'G-N67JG3FFZT',
    metaPixelId: '',
    tiktokPixelId: 'D7Q911JC77UAV4MGGGR0',
    debug: false,
    attributionStorageKey: 'mwc_attribution_v1',
    allowedAttributionParams: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid', 'ttclid'],
    ...(mwcRuntimeConfig.analytics || {})
  },

  leadCapture: {
    enabled: true,
    supportEmailFallback: 'forwriterinfo@gmail.com',
    webhookUrl: '',
    audienceLabel: 'MWC prospects',
    incentiveLabel: 'checklist rangement + prochaines offres MWC',
    ...(mwcRuntimeConfig.leadCapture || {})
  },

  // IMPORTANT:
  // - ne jamais mettre de clé secrète Stripe dans ce fichier
  // - ici on ne met que des URLs publiques de checkout (Payment Links / Checkout pages)
  checkoutUrl: mwcRuntimeConfig.checkoutUrl || '',

  products: [
    {
      id: 'sink',
      name: 'Organisateur sous évier coulissant 2 niveaux',
      price: 39.90,
      compareAt: 59.90,
      badge: 'Produit star',
      description: '2 niveaux coulissants pour exploiter l’espace sous évier, accéder vite aux sprays et garder une zone plus nette sans fouiller.',
      benefits: ['2 niveaux coulissants', 'accès rapide aux produits ménagers', 'usage cuisine / salle de bain / buanderie'],
      image: '/assets/visuals/under-sink-organizer-real.jpg',
      checkoutUrl: 'https://buy.stripe.com/00wbJ08gNeNo6vvd5E8IU01'
    },
    {
      id: 'drawer-dividers',
      name: 'Diviseurs de tiroirs ajustables',
      price: 24.90,
      compareAt: 34.90,
      badge: 'Upsell',
      description: 'Séparent proprement couverts, accessoires ou maquillage pour un avant / après immédiat dans les tiroirs du quotidien.',
      benefits: ['s’adaptent à plusieurs largeurs de tiroir', 'avant / après très visuel', 'complément logique du produit star'],
      image: '/assets/visuals/drawer-dividers-real.jpg',
      checkoutUrl: 'https://buy.stripe.com/8x200i2Wt5cO8DD0iS8IU02'
    },
    {
      id: 'clear-organizers',
      name: 'Set d’organisateurs transparents de tiroir',
      price: 29.90,
      compareAt: 39.90,
      badge: 'Rangement',
      description: 'Pack visuel et rassurant pour structurer rapidement un tiroir de cuisine, salle de bain ou bureau.',
      benefits: ['plusieurs formats dans un seul set', 'matière transparente facile à comprendre', 'checkout direct déjà actif'],
      image: '/assets/visuals/clear-drawer-organizers-real.jpg',
      checkoutUrl: 'https://buy.stripe.com/6oU00i0Ol20CbPP8Po8IU03'
    },
    {
      id: 'cutlery-tray',
      name: 'Organisateur à couverts extensible',
      price: 27.90,
      compareAt: 37.90,
      badge: 'Cuisine',
      description: 'Un classique utile avec bénéfice immédiat : plus d’ordre, plus d’accès et une cuisine plus nette au quotidien.',
      benefits: ['format extensible selon le tiroir', 'catégorie cuisine simple à convertir', 'commande unitaire via Stripe'],
      image: '/assets/visuals/expandable-cutlery-tray-real.jpg',
      checkoutUrl: 'https://buy.stripe.com/5kQ7sKbsZ34G5rrfdM8IU04'
    },
    {
      id: 'stackable-bins',
      name: 'Bacs transparents empilables avec poignées',
      price: 34.90,
      compareAt: 44.90,
      badge: 'Maison pratique',
      description: 'Produit polyvalent pour cuisine, salle de bain et cellier, parfait pour crédibiliser un univers rangement complet.',
      benefits: ['poignées visibles et faciles à saisir', 'empilables pour gagner de la place', 'achat direct déjà branché'],
      image: '/assets/visuals/stackable-clear-bins-real.jpg',
      checkoutUrl: 'https://buy.stripe.com/28EfZg40xcFg6vv0iS8IU05'
    }
  ],

  bundles: [
    {
      id: 'launch-bundle',
      name: 'Bundle lancement — Sous évier + Diviseurs de tiroirs',
      items: ['sink', 'drawer-dividers'],
      checkoutUrl: 'https://buy.stripe.com/aFa9ASgNj0WyaLL6Hg8IU06'
    }
  ]
};
