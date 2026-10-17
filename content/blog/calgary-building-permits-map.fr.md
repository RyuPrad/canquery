Vous voulez voir où des permis de construction ont été demandés ou délivrés à Calgary, vérifier l’état d’un permis dans votre rue ou comparer l’activité entre les quartiers. La Ville de Calgary publie **Building Permits**, un jeu de données des demandes de permis déposées auprès de son service Planning & Development. Sur CanQuery, vous pouvez l’explorer sous forme de carte interactive ou l’ouvrir comme un tableau.

## Explorer les permis sur une carte

1. [Ouvrez la carte des permis de construction de Calgary dans CanQuery](/resources/socrata-calgary-open-data-resource-c2es-76ed?view=map). Chaque point correspond à l’emplacement d’un permis; la Ville enregistre l’adresse, la communauté et une géométrie ponctuelle pour chaque permis.
2. Zoomez sur votre quartier et sélectionnez un point pour lire le dossier : **PermitNum**, **PermitType**, **PermitClass**, **WorkClass**, la valeur **StatusCurrent** et les dates de demande, de délivrance et d’achèvement.
3. Passez à la vue tableau lorsque vous voulez filtrer plutôt que parcourir. Saisissez un nom de rue ou un numéro de permis dans le champ de recherche, ou filtrez la colonne **StatusCurrent** avec `=Issued Permit` pour ne conserver que les permis délivrés. Le signe `=` sélectionne une correspondance exacte selon l’orthographe de la Ville.
4. Exportez les lignes filtrées en CSV pour les reprendre dans un tableur. L’export est limité à 10 000 lignes; filtrez d’abord par communauté, par année ou par type de permis.

Le tableau est préparé lors de la première ouverture, ce qui peut prendre un moment. La copie reste ensuite disponible pour le filtrage, les graphiques et l’export. Les noms de colonnes et les valeurs restent en anglais, leur langue de publication.

## Lire un dossier de permis

Le jeu recense des **demandes**, y compris des permis délivrés, annulés ou achevés par la suite. **StatusCurrent** indique l’état du dossier; **AppliedDate**, **IssuedDate** et **CompletedDate** datent chaque étape. Un dossier avec une date de demande mais sans date de délivrance est une demande, pas une autorisation de construire.

**PermitClassGroup** et **WorkClassGroup** sont les catégories regroupées par la Ville, utiles pour compter l’activité résidentielle ou commerciale; **PermitClass** et **WorkClass** contiennent les valeurs détaillées. **LocationCount** et **LocationAddresses** comptent pour les permis qui visent plusieurs adresses, comme un projet de plusieurs bâtiments. La Ville renvoie les demandes générales sur les dossiers immobiliers à son service de recherche foncière : le jeu ouvert est un extrait publié, pas une recherche de titre.

## Vérifier les dates et la source officielle

La date du catalogue sur la fiche du jeu indique la dernière modification de la fiche ou du fichier par la Ville. Ce n’est pas la date d’inspection d’une propriété. La [page du jeu de données de la Ville de Calgary](https://data.calgary.ca/d/c2es-76ed) décrit les champs et renvoie à la FAQ sur le processus de permis.

Parmi les autres données de Calgary sur CanQuery, la [carte des zones inondables 1:100](/fr/blog/carte-zones-inondables-calgary) et les [limites des quartiers électoraux](/fr/blog/carte-quartiers-calgary) permettent de situer un permis par rapport aux zones réglementaires et aux quartiers.

## Poursuivre votre recherche à Calgary

La [page de Calgary](/places/calgary-ab) répertorie les autres jeux de données ouverts de la Ville. Lorsque vous partagez un résultat, indiquez la [fiche du jeu de données dans CanQuery](/datasets/calgary-open-data-c2es-76ed), la source officielle et la date de consultation.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Ville de Calgary](https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa/).
