import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import { ThreadResponseAnswerStatus } from '@/apollo/server/services/askingService';

const { wrenAIAdaptor, askingService } = components;

class ContentMap {
  private contentMap: { [key: string]: string } = {};

  // Method to append (concatenate) content to the map
  public appendContent(key: string, content: string) {
    if (!this.contentMap[key]) {
      this.contentMap[key] = '';
    }
    this.contentMap[key] += content;
  }

  // Method to get content from the map
  public getContent(key: string): string | undefined {
    return this.contentMap[key];
  }

  // Method to remove content from the map
  public remove(key: string) {
    delete this.contentMap[key];
  }
}

const contentMap = new ContentMap();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const { responseId } = req.query;
  if (!responseId) {
    res.status(400).json({ error: 'responseId is required' });
    return;
  }
  try {
    const response = await askingService.getResponse(Number(responseId));
    if (!response) {
      throw new Error(`Thread response ${responseId} not found`);
    }

    // check response status
    if (
      response.answerDetail?.status !== ThreadResponseAnswerStatus.STREAMING
    ) {
      throw new Error(
        `Thread response ${responseId} is not in streaming status`,
      );
    }

    const queryId = response.answerDetail?.queryId;
    if (!queryId) {
      throw new Error(`Thread response ${responseId} does not have queryId`);
    }

    const stream = await wrenAIAdaptor.streamTextBasedAnswer(queryId);

    stream.on('data', (chunk) => {
      // pass the chunk directly to the client
      res.write(chunk);
      contentMap.appendContent(queryId, chunk);
    });

    stream.on('end', () => {
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
      askingService
        .changeThreadResponseAnswerDetailStatus(
          Number(responseId),
          ThreadResponseAnswerStatus.FINISHED,
          contentMap.getContent(queryId),
        )
        .then(() => {
          console.log(
            'Thread response answer detail status updated to FINISHED',
          );
          contentMap.remove(queryId);
        })
        .catch((error) => {
          console.error(
            'Failed to update thread response answer detail status',
            error,
          );
          contentMap.remove(queryId);
        });
    });

    // destroy the stream if the client closes the connection
    req.on('close', () => {
      stream.destroy();
      askingService
        .changeThreadResponseAnswerDetailStatus(
          Number(responseId),
          ThreadResponseAnswerStatus.INTERRUPTED,
          contentMap.getContent(queryId),
        )
        .then(() => {
          console.log(
            'Thread response answer detail status updated to INTERRUPTED',
          );
          contentMap.remove(queryId);
        })
        .catch((error) => {
          console.error(
            'Failed to update thread response answer detail status',
            error,
          );
          contentMap.remove(queryId);
        });
    });
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
}
