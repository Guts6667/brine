# Brine

Une application personnelle, en français, pour choisir une entreprise, comprendre pourquoi la contacter et décider de la prochaine action. La base de travail démarre vide. Le mode local ne nécessite aucun compte ni clé API. La version en ligne utilise Vercel et une base Turso privée. L’interface reprend les contrastes de [Studio Pickles](https://www.studiopickles.io/en) : noir, crème, accent citron, boutons en pilule et titres sans sérif/italique. Les polices utilisent les ressources du système, sans téléchargement externe.

## Installation et lancement

Utiliser Node.js 24 et npm, puis depuis ce dossier :

```sh
npm install
npm run dev
```

Ouvrir [Brine](http://127.0.0.1:3000). Pour un lancement avec le build de production :

```sh
npm run build
npm start
```

Les commandes locales écoutent sur `127.0.0.1`. La version hébergée fonctionne sur HTTPS, avec un mot de passe et une base partagée entre vos appareils.

## Usage et données

**Aujourd’hui** rassemble les actions en retard, celles du jour et les prospects prêts pour un premier contact, sans date planifiée, classés par score. **Prospects** permet d’ajouter une entreprise avec son nom seul. Sur sa fiche, enregistrer le contact et les observations, confirmer les cinq critères, puis utiliser **Prévoir la suite**. Terminer une action la conserve dans l’historique. Les étapes commerciales restent manuelles.

La cible (activité, zone, type d’entreprise, offre et exclusions) se modifie dans **Données et préférences**. Son exemple initial ne remplit pas les fiches sans validation. Chaque évaluation conserve la cible confirmée ; un changement demande une revalidation avant toute suggestion de premier contact. Les relevés IA sont facultatifs, saisis manuellement et séparés de la qualification.

Le barème fixe `pickles-v1` additionne l’adéquation (20/10/0), le problème concret (30/15/0), le déclencheur (20/10/0), les références (15/5/0) et l’accès professionnel (15/5/0). « À vérifier » est inconnu. Une réponse positive sans les justificatifs requis reste un brouillon enregistrable. Seuls cinq critères complets donnent un score sur 100 : priorité haute dès 70, intermédiaire dès 50, basse en dessous. Cette convention ne prédit pas un achat et ne prouve ni budget ni besoin reconnu.

**Ce que j’ai observé** documente neuf observations facultatives (site ancien, mobile, action principale, prestations, contact, avis Google, activité récente, site satisfaisant et inactivité vérifiée), avec notes, sources et dates. La taille reste séparée. Les observations reliées manuellement restent consultables depuis **Pourquoi ce score ?**. Elles n’ajoutent aucun point. Reprendre des notes ne change aucune réponse. Deux formulations d’un même défaut ne suffisent pas pour 30 points ; l’app vérifie les justificatifs présents, pas leur véracité.

Un changement récent doit dater de 0 à 90 jours avant sa vérification. Un déclencheur ancien demande une nouvelle vérification sans retrait silencieux de points. Une opposition, une cible non validée, un problème non établi ou un contact absent bloque les suggestions, quel que soit le score. Les étapes et l’archivage restent manuels.

Le volet replié **Après l’échange** distingue besoin, calendrier, budget, décision, capacité à avancer, solution et prochaine étape acceptée. Il ne crée aucun second score. La transition explicite **Passer à Opportunité qualifiée** exige un besoin reconnu, une solution pertinente, un chemin de décision identifié et une étape acceptée, sans opposition ni blocage confirmé. Un budget inconnu reste à vérifier. Une contradiction ultérieure demande une réévaluation et conserve l’historique.

SQLite conserve les données dans `data/brine.sqlite`, avec les fichiers associés `-wal` et `-shm` pendant l’utilisation. Si une installation possède déjà `data/pickles.sqlite` et aucune base `data/brine.sqlite`, Brine continue d’utiliser cette base existante. Les migrations versionnées se trouvent dans `migrations/` et s’appliquent au démarrage. Le dossier des données est exclu de Git et de `public/`. Pour choisir une autre base :

```sh
BRINE_DB_PATH=/chemin/prive/brine.sqlite npm run dev
```

La variable historique `PICKLES_DB_PATH` reste prise en charge ; `BRINE_DB_PATH` est prioritaire si les deux sont définies.

L’archivage est réversible. **Ne plus contacter** est distinct de l’étape et de l’archivage : il annule les actions actives et reste conservé jusqu’à une réactivation explicitement confirmée sur la fiche.

## Sauvegarde et restauration

Dans **Données et préférences**, télécharger la sauvegarde JSON complète : entreprises, contact principal, notes et échanges, historique, prochaines actions, oppositions, relevés IA et cible. Le fichier utilise le schéma v2, incluant qualification, observations, cible utilisée et après-échange. Les sauvegardes v1 restent importables : les anciennes réponses sont conservées sans déduction vers les nouveaux critères, qui démarrent à « À vérifier ».

Pour restaurer, choisir un JSON de 5 Mo maximum, vérifier l’aperçu des quantités, puis confirmer le remplacement. Tous les éléments et leurs relations sont validés avant l’écriture. Le remplacement est atomique. Une sauvegarde de l’état précédent est créée dans `data/backups/` en local (ou `backups/` à côté de la base choisie). En ligne, cette copie privée est enregistrée dans Turso au sein de la même transaction et se télécharge depuis **Données et préférences**.

Les oppositions existantes restent actives, même si le fichier restauré les omet. Elles sont rapprochées par identifiant, domaine ou nom et ville ; un domaine partagé peut donc conserver une opposition sur plusieurs fiches. Les fiches opposées absentes du fichier sont conservées et archivées. Une restauration ne réactive jamais le contact : cette décision se confirme ensuite sur la fiche.

Les sauvegardes contiennent des coordonnées et ne sont pas chiffrées par défaut. Conserver une copie dans un emplacement privé adapté.

## Version en ligne et accès privé

Le projet Vercel est `guts6667s-projects/brine`. Le stockage distant utilise le plan Turso `starter` gratuit, région Dublin. Les variables côté serveur sont :

- `TURSO_DATABASE_URL` et `TURSO_AUTH_TOKEN` : connexion à la base privée.
- `BRINE_PASSWORD_HASH` : hash scrypt salé du mot de passe.
- `BRINE_SESSION_SECRET` : clé aléatoire d’au moins 32 caractères.
- `BRINE_APP_ORIGIN` : origine HTTPS du domaine de production, si personnalisée. Les URL de déploiement Vercel sont également reconnues par leurs variables système.

Sur Vercel, une configuration de connexion ou de stockage incomplète bloque l’accès. L’application ne crée jamais une base locale de secours dans une fonction. Toutes les pages, sauvegardes et mutations sont protégées. La session dure 8 heures, dans un cookie HttpOnly, Secure et SameSite=Lax. Les tentatives de connexion sont limitées à 10 par adresse IP sur 15 minutes, avec un compteur persistant ; les adresses sont hachées et les mots de passe ne sont pas enregistrés en clair.

Les secrets sont exclus du dépôt et de l’envoi du code. Le fichier privé `.vercel/acces-brine.txt` contient le mot de passe initial. Pour le changer, générer un nouveau hash avec `hashPassword` de `lib/auth.ts`, remplacer la variable Vercel et redéployer. Changer le hash ou la clé de session invalide les sessions précédentes. Ne jamais utiliser de variable `NEXT_PUBLIC_` pour un secret.

Pour mettre à jour une version déjà configurée :

```sh
npm run typecheck
npm test
npm run build
git push origin main
```

Le mode local continue d’utiliser SQLite tant que les variables Turso ne sont pas définies. Les données d’une base locale et celles de la version en ligne ne se synchronisent pas automatiquement : l’import initial et les transferts ultérieurs passent par une sauvegarde JSON complète.

## Vérifications

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npx playwright test --config playwright.auth.config.ts
```

Les tests de stockage utilisent des bases temporaires. Playwright démarre sur `127.0.0.1:3100` avec une base dédiée `test-results/e2e/brine.sqlite`, réinitialisée avant chaque exécution ; il ne touche pas la base de travail. Les tests navigateur couvrent le parcours principal, les oppositions, l’archivage, les relevés IA, la restauration, le clavier, l’affichage étroit et le rejet d’origines non autorisées.

## Limites de la V1

Un seul utilisateur et un seul contact principal par entreprise. Aucun envoi d’email ou autre contact externe, synchronisation Gmail, scraping, appel d’API IA, audit automatique, PDF, facturation, calendrier complexe, import Excel universel ou travail en équipe. Les liens enregistrés ne sont pas téléchargés automatiquement. Les notes sont affichées comme du texte. En ligne, les données sont hébergées dans une base Turso en Europe et traitées par Vercel. En local, elles restent sur cet ordinateur.

Références techniques : [hébergement local Next.js](https://nextjs.org/docs/app/guides/self-hosting), [CLI Next.js et nom d’hôte](https://nextjs.org/docs/app/api-reference/cli/next), [cas d’usage SQLite](https://www.sqlite.org/whentouse.html).
