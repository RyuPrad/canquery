Vous avez remarqué des travaux dans une rue de Toronto et souhaitez savoir ce qu’en disent les dossiers municipaux. Le jeu de données **Building Permits – Active Permits** constitue un point de départ utile. Il regroupe les demandes et permis de construction actifs, à partir des renseignements recueillis dans les demandes et des mises à jour effectuées pendant l’examen et les inspections de la Ville.

CanQuery permet de consulter cette table officielle dans votre navigateur. Vous pouvez commencer par un nom de rue, examiner les résultats et suivre le lien vers la source pour obtenir davantage de contexte.

## Ouvrir la table des permis actifs

1. [Ouvrez les permis de construction actifs de Toronto dans CanQuery](/resources/ckan-toronto-open-data-resource-6d0229af-bc54-46de-9c2b-26759b01dd05).
2. Saisissez un nom de rue dans le champ de recherche au-dessus de la table. La recherche porte sur le texte des données : une correspondance peut donc apparaître dans une description plutôt que dans l’adresse.
3. Vérifiez les champs du nom de rue et du numéro d’immeuble. Une rue peut compter plusieurs demandes, et une même propriété peut avoir plusieurs dossiers de permis.
4. Lisez ensemble le type de permis, son statut et la description des travaux. Faites défiler la table horizontalement pour afficher les colonnes qui ne tiennent pas sur un petit écran.
5. Copiez l’adresse de la page pour retrouver cette recherche. L’export CSV permet aussi de consulter les résultats dans un tableur; il est limité à 10 000 lignes.

Pour une rue précise, saisissez `=KING` dans le filtre de la colonne **STREET_NAME** pour une correspondance exacte, en respectant l’orthographe enregistrée par le producteur. Le signe `=` sélectionne l’égalité; `KING` seul demande un filtre de contenu et peut nécessiter une préparation. Les filtres d’égalité fonctionnent avec le DataStore en direct et avec une copie préparée. Ce filtre vise le champ de la rue plutôt que le mot « King » dans une description de travaux; vérifiez séparément le numéro d’immeuble et la direction de la rue. La consultation de la table en direct dans le navigateur ne nécessite ni compte ni téléchargement manuel. Les noms de colonnes et les valeurs restent dans leur langue de publication.

Pour répéter cette extraction, le [parcours de l’API pour les rapports](/docs#workflow) présente la vérification des métadonnées, `filters={"STREET_NAME":"KING"}`, une requête limitée et l’export CSV. Il utilise la même ressource de permis actifs. Conservez la requête, la source et la date de consultation avec les résultats.

## Choisir les permis actifs ou les dossiers clôturés

- **Demandes et permis actifs :** consultez le [jeu des permis actifs](/datasets/toronto-open-data-building-permits-active-permits) pour explorer les dossiers toujours enregistrés dans le processus actif de la Ville. Lisez chaque statut; une demande n’est pas nécessairement un permis délivré.
- **Dossiers terminés ou clôturés :** consultez le [jeu distinct des permis clôturés](/datasets/toronto-open-data-building-permits-cleared-permits). La [documentation municipale des permis clôturés](https://open.toronto.ca/dataset/building-permits-cleared-permits/) décrit ces dossiers comme terminés ou clôturés et précise que les enregistrements dont **APPLICATION_DATE** précède le 1er octobre 1999 peuvent être incomplets, car ils proviennent d’anciens systèmes.

Ces jeux couvrent des populations de dossiers différentes. Une recherche active vide ou la présence d’un dossier clôturé ne permet pas d’établir l’historique complet des permis d’une propriété. Vérifiez les champs et les dates du jeu choisi avant de comparer les résultats.

## Comprendre la présence d’un dossier

La source comprend **des demandes ainsi que des permis**. La présence d’un dossier ne suffit pas à établir qu’un permis a été délivré ou que les travaux ont commencé. Consultez le statut et la description de chaque dossier pour comprendre ce qu’il représente.

Il s’agit aussi de dossiers actifs, et non d’un historique complet de tous les travaux. Une recherche vide ne prouve pas qu’une propriété n’a jamais fait l’objet d’un permis. Vérifiez l’orthographe, essayez un nom de rue plus court et consultez la description fournie par la Ville avant de tirer une conclusion.

## Vérifier les dates et la source

La date de mise à jour des métadonnées concerne la fiche du jeu de données. Elle ne correspond pas nécessairement à la date d’inspection d’une propriété. De même, la date « Liens vérifiés » de ce guide indique quand nous avons vérifié les liens et le parcours de consultation, pas chaque permis.

La [page officielle des permis actifs de la Ville de Toronto](https://open.toronto.ca/dataset/building-permits-active-permits/) fournit les renseignements sur la collecte, les ressources et leur publication. Pour une question concernant une demande précise, adressez-vous à la Ville; CanQuery donne accès aux dossiers publiés.

## Poursuivre votre recherche à Toronto

La [page de Toronto](/places/toronto-on) permet de découvrir d’autres données locales. Lorsque vous partagez un résultat, incluez la [fiche du jeu de données dans CanQuery](/datasets/toronto-open-data-building-permits-active-permits), la source officielle et la date de consultation pour que d’autres personnes puissent vérifier les mêmes renseignements.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Toronto](https://open.toronto.ca/open-data-licence/).
