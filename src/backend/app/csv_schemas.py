from pydantic import BaseModel, ConfigDict, Field
from .followup_schemas import WorkspaceView

MAX_BYTES = 1024 * 1024
MAX_ROWS = 500
HEADERS = ['invoice_no','customer_id','issue_date','due_date','total_amount','initial_payment']

class CsvInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    csv_text: str = Field(max_length=MAX_BYTES)

class CsvError(BaseModel):
    column: str
    message: str

class CsvRow(BaseModel):
    row_number: int
    values: dict[str,str]
    customer_name: str | None = None
    outstanding_amount: str | None = None
    errors: list[CsvError] = []

class CsvPreview(BaseModel):
    rows: list[CsvRow] = []
    file_errors: list[str] = []
    valid_count: int = 0
    invalid_count: int = 0
    can_import: bool = False
    total_amount: str = '0.00'
    initial_payment: str = '0.00'
    outstanding_amount: str = '0.00'

class CsvImportResult(BaseModel):
    imported_count: int
    workspace: WorkspaceView
