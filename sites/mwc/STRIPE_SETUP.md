# Stripe pour MWC

## Modèle actif aujourd’hui
Le storefront MWC reste **statique côté front**.

Le comportement actuel est volontairement simple :
- **1 produit seul** → lien Stripe Checkout direct au niveau du produit
- **bundle lancement exact** (`sink + drawer-dividers`) → lien Stripe Checkout direct au niveau du bundle
- **autre combinaison** → fallback assisté par email vers `forwriterinfo@gmail.com`

Cela évite de promettre un vrai panier multi-SKU dynamique sans backend.

## Où configurer les liens publics
Fichier : `assets/store-config.js`

Champs utilisés :
- `products[].checkoutUrl`
- `bundles[].checkoutUrl`
- `checkoutUrl` global en secours éventuel

Exemple :
```js
checkoutUrl: 'https://buy.stripe.com/xxxx'
```

## Règles de sécurité
Ne jamais mettre ici :
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- toute clé secrète ou endpoint serveur privé

Donc :
- jamais dans `index.html`
- jamais dans `assets/store-config.js`
- jamais côté navigateur

## Si on veut un vrai panier multi-produits plus tard
Deux options propres :
1. créer plus de bundles Stripe / Payment Links pour les combinaisons les plus probables
2. ajouter un backend qui crée une session Stripe Checkout dynamique à partir du panier

## Fichiers utiles
- staging live : `/opt/hermes/data/home/mwc-live-staging/opt/txt/sites/mwc/assets/store-config.js`
- logique front : `/opt/hermes/data/home/mwc-live-staging/opt/txt/sites/mwc/assets/app.js`
- note de handoff : `MWC-SOURCING-STATUS.md`
