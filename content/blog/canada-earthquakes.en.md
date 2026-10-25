You want to know how often the ground shakes near you, find the largest earthquakes recorded in a province, or count events by year. Natural Resources Canada (NRCan) publishes the earthquakes located by Earthquakes Canada as open data. Its CSV file is a live table on CanQuery, so you can search, sort, filter and chart more than 100,000 events in the browser.

| At a glance | |
|---|---|
| Publisher | Natural Resources Canada (Earthquakes Canada) |
| What it lists | One row per located earthquake: time, position, depth, magnitude and nearest place |
| Time span of the CSV | January 1, 1985 to December 31, 2019: 101,365 events |
| Area | Canada and nearby areas, including parts of Alaska and Washington State |
| On CanQuery | A live table in English and in French, with search, filters, charts and CSV export of up to 10,000 rows |
| After 2019 | Earthquakes Canada's own search covers recent and current events |

The dataset is titled **Earthquakes in Canada 2010-2019**, but its CSV files hold the full archive from 1985: the 2010s account for 44,561 of the rows.

## Find earthquakes in the table

1. [Open the earthquake table in CanQuery](/resources/f9fefce6-f183-4e7c-9917-2e210ad09fd4). Each row is one event.
2. Sort the **magnitude** column from largest to smallest to see the strongest events first. The largest in the file is a magnitude 7.7 (**Mw**) earthquake on October 28, 2012, 83 km SSW of Sandspit, BC.
3. To keep one province, filter the unnamed **column_8**, which holds the province or state after the place name. It is free text whose spelling changed over the years and which sometimes carries a note such as `Felt` or `Aftershock`, so use a contains filter, which ignores case, and repeat it for each spelling: `BC` and `B.C.` for British Columbia, or `QC` and `QUE` for Quebec.
4. To keep one year, type the year with a hyphen, such as `2015-`, in the **date** column filter: a plain value is a contains filter, and dates are written as `2015-06-21T…`.
5. Switch to the chart view to count events or compare magnitudes, and export the filtered rows as CSV, up to 10,000 rows per export.

## Read the fields

| Column | Meaning |
|---|---|
| **date** | Origin time, in Coordinated Universal Time (UTC, `+0000`) |
| **latitude**, **longitude** | Epicentre, in decimal degrees |
| **depth** | Depth of the event below the surface; for most earthquakes it is poorly known and often a nominal or default value |
| **magnitude** | Size of the event |
| **magnitude type** | How the magnitude was measured: **ML** is local (Richter) magnitude, **MN** is the Nuttli magnitude used for eastern Canada and **Mw** is moment magnitude; codes such as **MLSn**, **mb** and **MS** also appear |
| **place** | Distance and direction from the nearest named place |
| **column_8** | Province, territory or state, sometimes followed by a note such as `Felt` or `Aftershock` |

Magnitudes of different types are not strictly comparable, so read **magnitude type** before ranking events, and keep the type when you quote a value. Earthquakes Canada puts the uncertainty of a magnitude estimate at about plus or minus 0.3 units. Most rows are small events: more than four in five are below magnitude 3.

## Know the limits

The file stops at the end of 2019 and is a snapshot of the catalogue; later revisions of an event's location or magnitude are not reflected in it. Smaller events are more likely to be recorded where seismograph stations are dense, so a difference in counts between two regions can reflect the network as well as the ground.

The same rows are published as a French table, [Tremblements de terre canadien (français)](/resources/ab19e6ef-fa1e-43fa-a355-ff3d61d849eb), whose columns are named **profondeur** and **type de magnitude**. The dataset also offers KML, file geodatabase and map service formats for GIS work.

## Check the official source

For events after 2019, recent earthquakes and the authoritative record of any event, [search the National Earthquake Database](https://www.earthquakescanada.nrcan.gc.ca/stndon/NEDB-BNDS/bulletin-en.php) on [Earthquakes Canada](https://www.earthquakescanada.nrcan.gc.ca/): it provides bulletin data from 1985 onward and filters by time, magnitude, depth, event type and area. Its information for the last year is preliminary and may change. The [Government of Canada's dataset page](https://open.canada.ca/data/en/dataset/2c3672b6-4c17-4ff5-9861-29e2dd6d03b3) carries NRCan's description and the original files.

When you share a finding, include the [CanQuery dataset page](/datasets/2c3672b6-4c17-4ff5-9861-29e2dd6d03b3), the filters you used and the date you consulted it.

Contains information licensed under the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
