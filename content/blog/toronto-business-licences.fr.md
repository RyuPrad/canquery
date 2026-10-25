Vous voulez savoir si un commerce, un entrepreneur ou un vendeur ambulant de Toronto détient un permis d’entreprise municipal, ou dresser la liste des entreprises autorisées dans une catégorie. Le jeu de données **Municipal Licensing and Standards – Business Licences and Permits** de la Ville de Toronto est le registre officiel des catégories de permis et de licences délivrés par Municipal Licensing & Standards (ML&S). CanQuery en propose une table en direct : vous pouvez la consulter dans votre navigateur sans télécharger un fichier de 35 Mo.

Le jeu couvre des catégories commerciales comme les établissements de restauration, les centres holistiques, les rénovateurs et les vendeurs ambulants. La Ville précise qu’il n’inclut pas les permis personnels, par exemple ceux des chauffeurs de taxi ou des praticiens holistiques.

| En bref | |
|---|---|
| Producteur | Ville de Toronto, Municipal Licensing & Standards (ML&S) |
| Contenu | Les permis et licences d’entreprise par catégorie; les permis personnels, comme ceux des chauffeurs de taxi, ne sont pas inclus |
| Taille | Environ 160 000 dossiers |
| Recherche par | **Operating Name**, **Client Name**, rue, **Category**, **Licence No.**, **Ward** |
| Toujours actif? | Un dossier avec une **Cancel Date** n’est plus un permis actif |
| Dans CanQuery | Une table en direct actualisée à partir du DataStore de la Ville, avec export CSV jusqu’à 10 000 lignes |

## Ouvrir la table des permis d’entreprise

1. [Ouvrez la table des permis d’entreprise de Toronto dans CanQuery](/resources/ckan-toronto-open-data-resource-169e90ba-3ae0-43dd-8b2f-919e87002f50). La copie préparée sur CanQuery compte environ 160 000 enregistrements et provient du DataStore de la Ville.
2. Saisissez un nom commercial, un nom de client ou une rue dans le champ de recherche au-dessus de la table. La recherche porte sur le texte de toutes les colonnes : un nom de rue peut donc correspondre à l’adresse du permis comme à un nom d’entreprise contenant le même mot.
3. Lisez ensemble **Category**, **Licence No.**, **Operating Name**, **Issued** et **Cancel Date**. Un enregistrement doté d’une date d’annulation n’est plus un permis actif, même s’il reste dans la table.
4. Utilisez la colonne **Ward** pour limiter la recherche à un secteur de la ville, et **Conditions** ou **Endorsements** pour voir les restrictions attachées à un permis.
5. Exportez les lignes filtrées en CSV pour les reprendre dans un tableur. L’export est limité à 10 000 lignes; filtrez d’abord par catégorie ou par quartier pour obtenir un extrait complet.

Pour une correspondance exacte sur une catégorie, saisissez `=EATING ESTABLISHMENT` dans le filtre de la colonne **Category**. Le signe `=` sélectionne l’égalité selon l’orthographe enregistrée par la Ville; un mot seul demande un filtre de contenu. Les noms de colonnes et les valeurs sont publiés en anglais seulement.

## Lire un enregistrement avec prudence

La table présente des enregistrements de permis, et non un jugement sur une entreprise. Une ligne indique que la Ville a délivré un permis de cette catégorie à la date **Issued**, au **Client Name** exploitant sous le **Operating Name** à l’adresse indiquée. Consultez **Last Record Update** pour connaître la dernière modification du dossier, et rappelez-vous que la date du catalogue décrit la fiche, pas le jour d’une inspection.

Une recherche vide ne prouve pas qu’une entreprise n’a pas de permis. Elle peut exercer sous une autre dénomination, son permis peut relever d’une catégorie absente de ce jeu, ou l’orthographe peut différer du dossier municipal. Essayez l’adresse, un nom plus court ou le numéro de permis affiché dans l’établissement avant de conclure.

## Suivre la source officielle

La [page du jeu de données de la Ville de Toronto](https://open.toronto.ca/dataset/municipal-licensing-and-standards-business-licences-and-permits/) décrit les catégories, la fréquence de mise à jour et le fichier readme qui accompagne les données. Un jeu distinct, [Business Licence Renewals and New Issues Summary](/datasets/toronto-open-data-municipal-licensing-and-standards-business-licence-renewals-and-new-issues-summary), compte les renouvellements et les nouveaux permis par période si vous cherchez des totaux plutôt que des enregistrements.

Les questions sur un permis précis relèvent de Municipal Licensing & Standards. CanQuery fournit une copie interrogeable des dossiers publiés et un lien vers la source.

## Poursuivre votre recherche à Toronto

La [page de Toronto](/places/toronto-on) répertorie les autres jeux de données ouverts de la Ville, dont les [permis de construction actifs](/fr/blog/permis-construction-toronto). Lorsque vous partagez un résultat, indiquez la [fiche du jeu de données dans CanQuery](/datasets/toronto-open-data-municipal-licensing-and-standards-business-licences-and-permits), la source officielle et la date de consultation.

Contient des renseignements visés par la [Licence du gouvernement ouvert – Toronto](https://open.toronto.ca/open-data-licence/).
