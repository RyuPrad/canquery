Vous avez besoin de données d’altitude ou de terrain pour une partie de la Colombie-Britannique : un modèle de terrain pour une étude d’inondation, un nuage de points pour un modèle 3D ou la hauteur du couvert forestier. La Colombie-Britannique publie ses relevés lidar aéroportés par **LidarBC**, Ressources naturelles Canada (RNCan) publie des nuages de points de projets menés partout au Canada, et certaines villes publient leurs propres relevés. CanQuery réunit ces collections dans un même catalogue et vous mène à chaque téléchargement.

| En bref | |
|---|---|
| Portail provincial | LidarBC, géré par GeoBC |
| Produits | Nuages de points (LAZ), modèles numériques d’élévation (GeoTIFF à 1 m et 10 m), modèles de surface, modèles de hauteur du couvert et mesures des arbres |
| Couverture provinciale | 211 974 km² offerts sur le portail selon le bulletin de LidarBC de septembre 2026; de nouvelles données s’ajoutent chaque mois |
| Nuages de points fédéraux | Série CanÉlévation de RNCan, en fichiers LAZ ou COPC (Cloud Optimized Point Cloud) |
| Exemple municipal | Le relevé 2020 d’Abbotsford : 541 tuiles, chacune avec son fichier LAS |
| Licence | Licence du gouvernement ouvert de la Colombie-Britannique (LidarBC) et du Canada (RNCan), sans frais |

Le portail LidarBC et le relevé d’Abbotsford sont publiés en anglais seulement.

## Télécharger depuis LidarBC

1. [Ouvrez la fiche de LidarBC dans CanQuery](/resources/f01a8ef6-f229-4e21-bbe3-40d32664eb7f). Elle mène à la notice du catalogue de données de la C.-B. sur le [portail LidarBC](https://lidar.gov.bc.ca/).
2. Sur le portail, ouvrez l’onglet **Discovery and Download**, zoomez sur votre secteur et sélectionnez une tuile, puis utilisez le lien **Download Link** de la fenêtre contextuelle.
3. Pour plusieurs tuiles, utilisez l’outil **Select** et la table attributaire. Chaque fichier se télécharge séparément.
4. Conservez le fichier de métadonnées fourni avec chaque téléchargement : LidarBC le présente comme la source la plus fiable sur les données, y compris leur acquisition et leur précision.

LidarBC offre les nuages de points en fichiers LAZ compressés et les modèles numériques d’élévation (MNE) en GeoTIFF à 1 m ou à 10 m. Sa liste de produits comprend aussi des modèles numériques de surface, des modèles de hauteur du couvert, des mesures de la structure des arbres et du couvert et une base de données d’arbres individuels.

## Obtenir les nuages de points fédéraux

La série [Nuages de points lidar – Série CanÉlévation](/datasets/7069387e-9986-4297-9f55-0288e9676947) de RNCan réunit des nuages de points de projets lidar aéroportés menés par RNCan ou ses partenaires partout au Canada, en format LAZ compressé ou COPC, avec des coordonnées UTM NAD83(SCRS) et des hauteurs CGVD2013.

1. Ouvrez le [répertoire de téléchargement des nuages de points](/resources/ff1b0125-7330-4350-91de-c00df926cd51) pour parcourir les projets et les tuiles, ou utilisez les index des tuiles et des projets du jeu de données pour trouver les fichiers de votre secteur.
2. Pour de nombreux fichiers, les [instructions de téléchargement](/resources/9bc9aa40-7427-4504-b946-9f353b7c2ce5) décrivent un téléchargement en bloc avec l’outil en ligne de commande d’AWS, à partir de `aws s3 ls --no-sign-request s3://canelevation-lidar-point-clouds/pointclouds_nuagespoints/`.

RNCan diffuse chaque projet séparément : des projets qui couvrent un même secteur peuvent donc se chevaucher. Il indique une précision verticale généralement comprise entre 5 et 10 cm.

## Vérifier les relevés municipaux

Certaines municipalités publient leurs propres relevés lidar. Le relevé [LiDAR 2020](/resources/arcgis-cd8555180c5045daa64af7db88332ef5-0-data?view=map) de la Ville d’Abbotsford, effectué le 8 avril 2020, est une grille de 541 tuiles que CanQuery affiche sur une carte; le champ **URL** de chaque tuile contient l’adresse de son fichier LAS classifié. Ses métadonnées indiquent des coordonnées UTM zone 10N NAD83 (SCRS) et des hauteurs CGVD28 : convertissez l’un des systèmes de référence altimétrique avant de le combiner avec les données CanÉlévation.

Pour en trouver d’autres, [cherchez « lidar » dans CanQuery](/?q=lidar) et lisez la couverture et la date de chaque producteur.

## Connaître les limites

Les fichiers lidar sont volumineux : ne téléchargez que les tuiles dont vous avez besoin. LidarBC n’offre pas les données brutes des capteurs, et aucune mise à jour à l’échelle de la province n’est prévue après son programme initial : l’année d’acquisition de chaque tuile compte donc pour les secteurs qui ont changé depuis.

## Vérifier la source officielle

La [page LidarBC de la province](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/lidarbc) et le [portail LidarBC](https://lidar.gov.bc.ca/) (en anglais) décrivent le programme, ses produits et la façon de les télécharger. La [page du jeu de données de RNCan](https://ouvert.canada.ca/data/fr/dataset/7069387e-9986-4297-9f55-0288e9676947) présente les spécifications des produits.

Quand vous partagez un résultat, indiquez le nom des tuiles, leur année d’acquisition et la date de téléchargement.

Contient des renseignements visés par l’[Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content/data/policy-standards/data-policies/open-data/open-government-licence-bc) (en anglais) et la [Licence du gouvernement ouvert – Canada](https://ouvert.canada.ca/fr/licence-du-gouvernement-ouvert-canada).
