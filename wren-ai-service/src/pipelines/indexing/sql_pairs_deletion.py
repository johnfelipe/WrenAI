import logging
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from hamilton import base
from hamilton.async_driver import AsyncDriver
from langfuse.decorators import observe

from src.core.pipeline import BasicPipeline
from src.core.provider import DocumentStoreProvider
from src.pipelines.indexing import SqlPairsCleaner

logger = logging.getLogger("wren-ai-service")


## Start of Pipeline
@observe(capture_input=False, capture_output=False)
async def delete_sql_pairs(
    sql_pairs_cleaner: SqlPairsCleaner,
    sql_pair_ids: List[str],
    id: Optional[str] = None,
) -> None:
    return await sql_pairs_cleaner.run(sql_pair_ids=sql_pair_ids, id=id)


## End of Pipeline


class SqlPairsDeletion(BasicPipeline):
    def __init__(
        self,
        document_store_provider: DocumentStoreProvider,
        **kwargs,
    ) -> None:
        sql_pairs_store = document_store_provider.get_store(dataset_name="sql_pairs")

        self._components = {
            "sql_pairs_cleaner": SqlPairsCleaner(sql_pairs_store),
        }

        super().__init__(
            AsyncDriver({}, sys.modules[__name__], result_builder=base.DictResult())
        )

    def visualize(self, sql_pair_ids: List[str], id: Optional[str] = None) -> None:
        destination = "outputs/pipelines/indexing"
        if not Path(destination).exists():
            Path(destination).mkdir(parents=True, exist_ok=True)

        self._pipe.visualize_execution(
            ["delete_sql_pairs"],
            output_file_path=f"{destination}/sql_pairs_deletion.dot",
            inputs={
                "sql_pair_ids": sql_pair_ids,
                "id": id or "",
                **self._components,
            },
            show_legend=True,
            orient="LR",
        )

    @observe(name="SQL Pairs Deletion")
    async def run(
        self, sql_pair_ids: List[str], id: Optional[str] = None
    ) -> Dict[str, Any]:
        logger.info("SQL Pairs Deletion pipeline is running...")
        return await self._pipe.execute(
            ["delete_sql_pairs"],
            inputs={
                "sql_pair_ids": sql_pair_ids,
                "id": id or "",
                **self._components,
            },
        )


if __name__ == "__main__":
    from src.pipelines.common import dry_run_pipeline

    dry_run_pipeline(
        SqlPairsDeletion,
        "sql_pairs_deletion",
        sql_pair_ids=[],
    )
