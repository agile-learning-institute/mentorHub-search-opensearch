import { Client } from "@opensearch-project/opensearch";
const fs = require("fs");

const host: string = process.env.HOST!;
const protocol: string = process.env.PROTOCOL!;
const port: string = process.env.PORT!;
const auth: string = process.env.AUTH!;
const indexName: string = process.env.OPENSEARCH_INDEX!;
const loadTest: string = process.env.LOAD_TEST!;


async function main()
{
    console.log("HOST: " + host + ", PROTOCOL: " + protocol + ", PORT: " + port + ", AUTH: " + auth + ", INDEXNAME: " + indexName + ", LOADTESTDATA: ", loadTest);
    console.log("Creating OpenSearch Client with Node:", protocol + "://" + auth + "@" + host + ":" + port);
    const opensearchClient: Client = new Client({
        node: protocol + "://" + auth + "@" + host + ":" + port
    });

    const mappingPath: string = 'mapping.json';
    const testDataPath: string = 'test-data.json';

    try {
        await testConnection();

        await verifyAndCreateIndex();

        await createOrUpdateIndexMapping();
        if (loadTest === "true") {
            await indexTestData();
        }
        else {
            console.log("Loading testing data disabled");
        }

    }
    catch (error) {
        console.log(error);
    }
    finally {
        console.log("All done!");
        opensearchClient.close();
    }


    async function indexTestData()
    {

        const testData = JSON.parse(fs.readFileSync(testDataPath, 'utf8'));
        // Do necessary transformations on test data
        const transformedTestData = transformData(testData);

        // Index the data
        console.log("Attemping to index test data...");
        const response = await opensearchClient.bulk({
            index: indexName,
            body: transformedTestData.flatMap((doc: any) => [
                { index: { _index: indexName } },
                doc,
            ])
        });

        if (!response.body.errors) {
            console.log("Successfully indexed test data!");
        }
        else {
            // Bulk sends a 200 if it reaches the server. 
            // Each document has their own status code, so we need to cycle through if there are errors in the body
            console.error("Errors occured during indexing");
            response.body.items.forEach((item: any, index: any) =>
            {
                console.error(`Item ${index + 1} details:`, item);
                console.error("Caused By:", item.index.error.caused_by);
            });
        }
    }

    function transformData(testData: any): any
    {
        console.log("Transforming test data before indexing...");
        return testData.map((doc: any) =>
        {
            //Opensearch doesn't like the source having an _id field, so we rename it. Eventually it will be along the lines of collectionNameId
            const { _id, ...transformedDoc } = doc;
            return { ...transformedDoc, 'ID': _id };
        });
    }

    async function createOrUpdateIndexMapping()
    {
        console.log("Trying to create/update mapping...");

        const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
        // Create/update if there's mapping for the data
        const response = await opensearchClient.indices.putMapping({
            index: indexName,
            body: mapping
        });
        if (response.statusCode === 400) {
            // It's likely that it'll be a type error, i.e. trying to change the type of an existing mapping from string to keyword
            throw new Error("Failed to create/update mapping: " + response.body + "\n Consider making a new container.");
        }
        else {
            console.log("Mapping has been created/updated!");
        }
    }

    async function verifyAndCreateIndex()
    {
        if (typeof indexName === "string") {
            // Check if index exists
            console.log("Verifying if index exists or needs to be created...");
            const indexExists = await opensearchClient.indices.exists({
                index: indexName
            });
            // The index exists API operation returns only one of two possible response codes: 200 – the index exists, and 404 – the index does not exist.
            // So we can check if statusCode === 404 with no edge cases
            if (indexExists.statusCode === 404) {
                console.log(`Index of ${indexName} doesn't exist, creating index`);
                await opensearchClient.indices.create({
                    index: indexName
                });
            }
            else {
                console.log(`Index ${indexName} exists!`);
            }
        }

    }

    async function testConnection()
    {
        if (await opensearchClient.ping()) {
            console.log('Opensearch server is reachable');
        }
        else {
            throw new Error('Did not recieve response from opensearch server');
        }
    }
}

main();