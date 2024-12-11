import { Knex } from 'knex';
import {
  BaseRepository,
  IBasicRepository,
  IQueryOptions,
} from './baseRepository';
import { camelCase, isPlainObject, mapKeys, mapValues } from 'lodash';
import { AskResultStatus } from '@server/models/adaptor';

export interface DetailStep {
  summary: string;
  sql: string;
  cteName: string;
}

export interface ThreadResponseBreakdownDetail {
  queryId: string;
  status: string;
  error?: object;
  description?: string;
  steps?: Array<DetailStep>;
}

export interface ThreadResponseAnswerDetail {
  queryId?: string;
  status: string;
  error?: object;
  numRowsUsedInLLM?: number;
  content?: string;
}

export interface ThreadResponse {
  id: number; // ID
  viewId?: number; // View ID, if the response is from a view
  threadId: number; // Reference to thread.id
  question: string; // Thread response question
  sql: string; // SQL query generated by AI service
  answerDetail?: ThreadResponseAnswerDetail; // AI generated text-based answer detail
  breakdownDetail?: ThreadResponseBreakdownDetail; // Thread response breakdown detail
}

export interface IThreadResponseRepository
  extends IBasicRepository<ThreadResponse> {
  getResponsesWithThread(
    threadId: number,
    limit?: number,
  ): Promise<ThreadResponse[]>;
}

export class ThreadResponseRepository
  extends BaseRepository<ThreadResponse>
  implements IThreadResponseRepository
{
  private readonly jsonbColumns = ['answerDetail', 'breakdownDetail'];

  constructor(knexPg: Knex) {
    super({ knexPg, tableName: 'thread_response' });
  }

  public async getResponsesWithThread(threadId: number, limit?: number) {
    const query = this.knex(this.tableName)
      .select('thread_response.*')
      .where({ thread_id: threadId })
      .leftJoin('thread', 'thread.id', 'thread_response.thread_id');

    if (limit) {
      query.orderBy('created_at', 'desc').limit(limit);
    }

    return (await query)
      .map((res) => {
        // turn object keys into camelCase
        return mapKeys(res, (_, key) => camelCase(key));
      })
      .map((res) => {
        // JSON.parse detail and error
        const answerDetail =
          res.answerDetail && typeof res.answerDetail === 'string'
            ? JSON.parse(res.answerDetail)
            : res.answerDetail;
        const breakdownDetail =
          res.breakdownDetail && typeof res.breakdownDetail === 'string'
            ? JSON.parse(res.breakdownDetail)
            : res.breakdownDetail;
        return {
          ...res,
          answerDetail: answerDetail || null,
          breakdownDetail: breakdownDetail || null,
        };
      }) as ThreadResponse[];
  }

  public async updateOne(
    id: string | number,
    data: Partial<{
      status: AskResultStatus;
      answerDetail: ThreadResponseAnswerDetail;
      breakdownDetail: ThreadResponseBreakdownDetail;
    }>,
    queryOptions?: IQueryOptions,
  ) {
    const transformedData = {
      status: data.status ? data.status : undefined,
      answerDetail: data.answerDetail
        ? JSON.stringify(data.answerDetail)
        : undefined,
      breakdownDetail: data.breakdownDetail
        ? JSON.stringify(data.breakdownDetail)
        : undefined,
    };
    const executer = queryOptions?.tx ? queryOptions.tx : this.knex;
    const [result] = await executer(this.tableName)
      .where({ id })
      .update(this.transformToDBData(transformedData as any))
      .returning('*');
    return this.transformFromDBData(result);
  }

  protected override transformFromDBData = (data: any): ThreadResponse => {
    if (!isPlainObject(data)) {
      throw new Error('Unexpected dbdata');
    }
    const camelCaseData = mapKeys(data, (_value, key) => camelCase(key));
    const formattedData = mapValues(camelCaseData, (value, key) => {
      if (this.jsonbColumns.includes(key)) {
        // The value from Sqlite will be string type, while the value from PG is JSON object
        if (typeof value === 'string') {
          return value ? JSON.parse(value) : value;
        } else {
          return value;
        }
      }
      return value;
    }) as ThreadResponse;
    return formattedData;
  };
}
