# MWC — création de support@mwc.gtixt.com avec redirection

## Faisabilité
Oui, c’est possible **si vous contrôlez la zone DNS de `gtixt.com`**.

## Option recommandée
Créer une boîte ou un alias de type `support@mwc.gtixt.com` puis rediriger vers `forwriterinfo@gmail.com`.

## Deux approches simples

### 1) Alias + forward chez le registrar / hébergeur mail
À utiliser si votre fournisseur DNS / email permet les alias sur sous-domaine.

- créer l’adresse `support@mwc.gtixt.com`
- activer la redirection vers `forwriterinfo@gmail.com`
- tester réception + réponse

### 2) Service de forwarding dédié (souvent le plus simple)
Exemples : ImprovMX, Zoho Mail, Migadu, OVH Mail selon le compte disponible.

Configuration type :
- définir les MX de `mwc.gtixt.com` vers le prestataire choisi
- ajouter SPF recommandé par le prestataire
- ajouter DKIM si émission depuis cette adresse plus tard
- créer l’alias `support@mwc.gtixt.com -> forwriterinfo@gmail.com`

## Points DNS à prévoir
- `MX` pour `mwc.gtixt.com`
- `TXT` SPF pour autoriser l’émission si vous envoyez depuis cette adresse
- `TXT` DKIM si vous envoyez depuis le domaine
- idéalement `DMARC` pour protéger la délivrabilité

## Recommandation opérationnelle
1. Commencer par du **forwarding entrant uniquement**.
2. Garder `forwriterinfo@gmail.com` comme destination réelle.
3. Une fois stable, configurer l’envoi sortant depuis `support@mwc.gtixt.com`.

## Important
Sans accès DNS/mail du domaine, je ne peux pas créer la boîte ni la redirection depuis ici. Mais la structure et le nom `support@mwc.gtixt.com` sont cohérents et exploitables.
