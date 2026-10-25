You need elevation or terrain data for a part of British Columbia: a bare-earth model for a flood study, a point cloud for a 3D model, or canopy heights for a forest plot. British Columbia publishes its airborne LiDAR through **LidarBC**, Natural Resources Canada (NRCan) publishes point clouds from projects across Canada, and some cities publish their own surveys. CanQuery lists these collections in one catalogue and links you to each download.

| At a glance | |
|---|---|
| Provincial portal | LidarBC, managed by GeoBC |
| Products | Point clouds (LAZ), digital elevation models (1-metre and 10-metre GeoTIFF), surface models, canopy height models and tree metrics |
| Provincial coverage | 211,974 km² available on the portal, according to LidarBC's September 2026 bulletin; new data is added monthly |
| Federal point clouds | NRCan's CanElevation Series, as LAZ or Cloud Optimized Point Cloud (COPC) files |
| City example | Abbotsford's 2020 survey: 541 tiles, each with its own LAS file |
| Licence | Open Government Licence – British Columbia (LidarBC) and – Canada (NRCan), with no fees |

## Download from LidarBC

1. [Open the LidarBC entry in CanQuery](/resources/f01a8ef6-f229-4e21-bbe3-40d32664eb7f). It links to the BC Data Catalogue record of the [LidarBC portal](https://lidar.gov.bc.ca/).
2. On the portal, open the **Discovery and Download** tab, zoom to your area and select a tile, then use the **Download Link** in the pop-up.
3. For several tiles, use the **Select** tool and the attribute table. Each file is downloaded individually.
4. Keep the metadata file included with each download: LidarBC calls it the most reliable source of information about the data, including its acquisition and accuracy.

LidarBC offers point clouds as compressed LAZ files and digital elevation models (DEMs) as 1-metre or 10-metre GeoTIFFs. Its product list also includes digital surface models, canopy height models, tree and canopy structure metrics and an individual tree database.

## Get federal point clouds

NRCan's [LiDAR Point Clouds – CanElevation Series](/datasets/7069387e-9986-4297-9f55-0288e9676947) gathers point clouds from airborne LiDAR projects conducted by NRCan or its partners across Canada, in compressed LAZ or COPC format, with NAD83(CSRS) UTM coordinates and CGVD2013 heights.

1. Open the [point clouds download directory](/resources/ff1b0125-7330-4350-91de-c00df926cd51) to browse projects and tiles, or use the tile and project indexes listed on the dataset page to find the files for your area.
2. For many files, the [download instructions](/resources/bbc6c7e1-63d6-4f75-a52d-e9f9ede355b8) describe a bulk download with the AWS command-line tool, starting from `aws s3 ls --no-sign-request s3://canelevation-lidar-point-clouds/pointclouds_nuagespoints/`.

NRCan distributes each project separately, so projects covering the same area can overlap. It gives the vertical accuracy of the point clouds as generally between 5 and 10 cm.

## Check city surveys

Some municipalities publish their own LiDAR. The City of Abbotsford's [LiDAR 2020](/resources/arcgis-cd8555180c5045daa64af7db88332ef5-0-data?view=map) survey, flown on April 8, 2020, is a grid of 541 tiles that CanQuery draws on a map; each tile's **URL** field holds the address of its classified LAS file. Its metadata gives NAD83 CSRS UTM zone 10N coordinates and CGVD28 heights, so convert one of the vertical datums before combining it with CanElevation data.

To find others, [search CanQuery for LiDAR](/?q=lidar) and read each publisher's coverage and date.

## Know the limits

LiDAR files are large, so download only the tiles you need. LidarBC does not offer raw, unprocessed sensor data, and it has no plans for a province-wide refresh after its initial program, so the acquisition year of each tile matters for areas that have changed since.

## Check the official source

The Province's [LidarBC page](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/lidarbc) and the [LidarBC portal](https://lidar.gov.bc.ca/) describe the program, its products and how to download them. NRCan's [dataset page](https://open.canada.ca/data/en/dataset/7069387e-9986-4297-9f55-0288e9676947) carries the product specifications.

When you share a result, include the tile names, the acquisition year and the date you downloaded the files.

Contains information licensed under the [Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content/data/policy-standards/data-policies/open-data/open-government-licence-bc) and the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
