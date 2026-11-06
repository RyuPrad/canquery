You want to know which of Toronto's 25 wards an address is in, who its councillor is, or how to reach the ward office. The City of Toronto publishes the ward boundaries in two open datasets: **City Wards**, with the boundary files, and **Wards and Elected Councillors**, which adds each ward's councillor with a phone number, an email address and a link to the councillor's page. CanQuery shows the second as an interactive map and a live table.

| At a glance | |
|---|---|
| Publisher | City of Toronto, City Clerk's Office |
| Wards | 25, in force since December 1, 2018 |
| Ward fields | **WARD_NUMBER** and **AREA_NAME**, for example Toronto Centre, ward 13 |
| Councillor fields | **COUNCILLOR**, **PHONE_NUMBER**, **EMAIL_ADDRESS** and **URL_LINK** |
| Recorded | **DATE_EFFECTIVE** 2025-04-16 on every row: the council in office before the October 26, 2026 election |
| On CanQuery | An interactive map and a 25-row live table you can search, sort and export as CSV |

## Find your ward on the map

1. [Open the Toronto ward map in CanQuery](/resources/ckan-toronto-open-data-resource-c76c2711-9e1e-4da4-8245-9ce3bb089a4b?view=map). Each polygon is one ward.
2. Zoom to your street; the basemap shows street names.
3. Select the ward covering your address and read **AREA_NAME** and **WARD_NUMBER**. **AREA_DESC** puts them together, as in "Toronto Centre (13)".

Near a boundary, zoom in further before you decide. If you still cannot tell, the City's [Members of Council](https://www.toronto.ca/city-government/council/members-of-council/) page has an address lookup that gives the ward and its councillor.

## Find your councillor

1. Switch the same resource to the [table view](/resources/ckan-toronto-open-data-resource-c76c2711-9e1e-4da4-8245-9ce3bb089a4b). It has one row per ward.
2. Search for the ward's name or filter **WARD_NUMBER**, then read **COUNCILLOR**, **PHONE_NUMBER** and **EMAIL_ADDRESS**.
3. **URL_LINK** opens the councillor's page on toronto.ca, with the councillor's office addresses, phone numbers and email.

Read the councillor fields with their date. Every row carries **DATE_EFFECTIVE** 2025-04-16, so the table names the councillors who held the seats before the municipal election of October 26, 2026. The council elected that day takes office on November 15, 2026, and the City Clerk's Office refreshes the dataset as new information is available. Until a newer table appears, look up your address on the [Members of Council](https://www.toronto.ca/city-government/council/members-of-council/) page before you write to a councillor.

## Download the ward boundaries

The [City Wards dataset](/datasets/toronto-open-data-city-wards) holds the boundary files. Its **City Wards Data** table has one row per ward with the geometry, and its ZIP files hold the 25-ward model in WGS84 latitude and longitude for GIS software. The City's description explains that the 25 wards follow the provincial electoral districts, with minor adjustments to fit Toronto's boundaries, and came into force on December 1, 2018.

The same dataset keeps two older models for historical work: the 44 wards in effect until November 30, 2018, in MTM and WGS84 versions, and the 47 wards drawn by the City's earlier ward boundary review. Use the 25-ward files for any current address.

## Compare the wards

The [Ward Profiles (25-Ward Model)](/datasets/toronto-open-data-ward-profiles-25-ward-model) dataset describes the population and households of each ward from the 2021, 2016 and 2011 censuses. It is the place to compare wards; the boundary layers record only the areas and their councillors.

## Check the official source

The City of Toronto's [Wards and Elected Councillors](https://open.toronto.ca/dataset/wards-and-elected-councillors/) and [City Wards](https://open.toronto.ca/dataset/city-wards/) pages carry the descriptions, the licence and the original downloads. Questions about a councillor or a ward belong with the City; CanQuery provides the map, the table and the links to the source. Other Ontario municipalities are covered in [Ontario ward maps 2026](/blog/ontario-ward-maps), and the [Toronto place page](/places/toronto-on) lists the City's other open datasets.

When you share a finding, include the [CanQuery dataset page](/datasets/toronto-open-data-wards-and-elected-councillors), the ward and the date you consulted it.

Contains information licensed under the [Open Government Licence – Toronto](https://open.toronto.ca/open-data-licence/).
