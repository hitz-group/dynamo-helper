import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import chunk from 'lodash/chunk';
import keyBy from 'lodash/keyBy';
import flatten from 'lodash/flatten';
import { AnyObject, TableConfig } from '../types';

/**
 * Get many items from the db matching the provided keys
 * @param keys array of key maps. eg: [{ pk: '1', sk: '2'}]
 * @returns list of items
 */
export async function batchGetItems(
  dbClient: DocumentClient,
  table: TableConfig,
  keys: DocumentClient.Key[],
  fields?: Array<string>,
): Promise<Array<AnyObject>> {
  let result: DocumentClient.BatchGetItemOutput;
  let unProcessedKeys = [];

  // Chunk requests to bits of 100s as max items per batchGet operation is 100
  // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
  if (keys.length > 100) {
    const results = await Promise.all(
      chunk(keys, 100).map(x => batchGetItems(dbClient, table, x)),
    );
    return flatten(results);
  }

  const items = [];
  const { partitionKeyName, sortKeyName } = table.indexes.default;

  const fieldsToProject = fields ? [...fields] : undefined;

  // If projection fields is given, add tables primary keys there by default
  if (fieldsToProject) {
    if (!fieldsToProject.includes(partitionKeyName)) {
      fieldsToProject.push(partitionKeyName);
    }

    if (!fieldsToProject.includes(sortKeyName)) {
      fieldsToProject.push(sortKeyName);
    }
  }

  do {
    result = await dbClient
      .batchGet({
        RequestItems: {
          [table.name]: {
            Keys: unProcessedKeys.length > 0 ? unProcessedKeys : keys,
            ProjectionExpression: fieldsToProject
              ? fieldsToProject.join(',')
              : undefined,
          },
        },
      })
      .promise();

    if (result.UnprocessedKeys && result.UnprocessedKeys[table.name]) {
      unProcessedKeys = result.UnprocessedKeys[table.name].Keys;
    }

    items.push(...(result.Responses[table.name] || []));
  } while (unProcessedKeys.length > 0);

  // DynamoDB doesn't return results in any order
  // To support dataloader pattern, sort result in same order as keys
  const itemsHash = keyBy(
    items,
    x => `${x[partitionKeyName]}::${x[sortKeyName]}`,
  );

  return keys.map(x => itemsHash[`${x[partitionKeyName]}::${x[sortKeyName]}`]);
}
