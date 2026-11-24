# VolleyStats

Statistiques de volley de l’équipe : saisie des actions pendant le match (à partir de la vidéo) et tableau de bord par match (efficacités, comparatif adverse, distribution du passeur).

## Accès

Site : `https://<utilisateur>.github.io/<dépôt>/` (lien communiqué par l’admin).

- **Coéquipiers** : ouvrez le lien sur votre téléphone pour consulter la liste des matchs et leur tableau de bord. Aucune connexion n’est nécessaire.
- **Admin** : le bouton « Admin » de la barre du haut permet de saisir et de modifier les matchs. Le code admin ne figure nulle part ici : demandez-le à l’admin de l’équipe.

## Technique

- Site statique (HTML/CSS/JavaScript, sans compilation), servi tel quel par GitHub Pages (fichier `.nojekyll`).
- Données locales dans le navigateur (`localStorage`), synchronisées avec Supabase (`assets/sync.js`).
- La clé Supabase présente dans `assets/config.js` est une clé publique en lecture seule. Toute écriture passe par des fonctions côté serveur qui vérifient le code admin (stocké haché) : masquer les boutons dans l’interface n’est qu’une question d’ergonomie.
- Pour tester en local : `python -m http.server 8773` à la racine, puis ouvrir `http://localhost:8773/`.
