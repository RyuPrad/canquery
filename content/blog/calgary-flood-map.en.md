You want to know whether a Calgary property sits in a regulated flood zone before you buy, renovate or apply for a development permit. The City of Calgary publishes its **Regulatory Flood Map (Bylaw Flood Hazard)**, the map of the floodway, flood fringe and overland flow zones used for land-use planning along the Bow River, the Elbow River, Nose Creek and West Nose Creek. On CanQuery you can explore it as an interactive map and open the zone table behind it.

## Explore the regulatory flood zones

1. [Open the Calgary regulatory flood map in CanQuery](/resources/socrata-calgary-open-data-resource-tp6q-x2v7?view=map). The polygons are the designated zones; the base map shows streets so you can find an address.
2. Zoom to the property and select the polygon covering it. The record shows **DESCRIPTION** (the zone type), **FLOOD_CD** (the City's zone code) and **PERIMETER**.
3. Switch to the table view to list every zone of one type, for example by filtering **DESCRIPTION** with the exact value the City uses for the floodway. The leading `=` in a column filter selects an exact match.
4. Follow the City's source link on the dataset page when you need the annotation file or the bylaw text that defines what each zone allows.

The table is prepared the first time someone opens it; it is small and loads quickly afterwards.

## What the zones mean

The City describes this map as the **1:100 flood extent calculated in 1983**, used to designate where the Land Use Bylaw's flood-related development and building regulations apply. The floodway is the most restrictive zone, the flood fringe allows development under conditions, and the overland flow zone marks areas that can flood when water leaves the river channel. Designated flood elevations, called steplines, are published as a [separate dataset](/datasets/calgary-open-data-mngv-ufjz).

The regulatory map is not the same as a probability map. The City also publishes modelled flood extents for several return periods, such as the [1:100 flood map](/datasets/calgary-open-data-w8wn-kuii), the [1:200 flood map](/datasets/calgary-open-data-ywjd-32pn) and the [1:1000 flood map](/datasets/calgary-open-data-gc28-8znr), which describe the chance of a flood of a given size in any year. Read the title of each dataset before comparing boundaries: a property outside the regulatory zones can still appear inside a low-probability modelled extent.

## Check the official source

The [City of Calgary's dataset page](https://data.calgary.ca/d/tp6q-x2v7) carries the description, the annotation attachment and the licence. For the development and building regulations that apply in each zone, the City points to its Land Use Bylaw. The map is a planning tool; questions about a specific permit application belong with the City.

The catalogue date on the dataset page records a change to the listing or the file, not a new flood study.

## Continue exploring Calgary

The [Calgary place page](/places/calgary-ab) lists the City's other open datasets, including [building permits](/blog/calgary-building-permits-map) you can read against these zones. When you share a finding, include the [CanQuery dataset page](/datasets/calgary-open-data-tp6q-x2v7), the official source and the date you consulted it.

Contains information licensed under the [Open Government Licence – City of Calgary](https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa/).
