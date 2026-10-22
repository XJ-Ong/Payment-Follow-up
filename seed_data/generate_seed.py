"""
Dynamic Seed Generator for Payment Follow-up (Orbyte Work Plugin)
Solves the 'today drift' problem: reads relative day offsets from seed_relative_invoices.json
and materializes exact YYYY-MM-DD dates relative to the day the script runs.
"""
import json
from datetime import datetime, timedelta, timezone

MY_TZ = timezone(timedelta(hours=8))

def materialize_seed_data(reference_date=None):
    if reference_date is None:
        reference_date = datetime.now(MY_TZ).date()
        
    with open("seed_relative_invoices.json", "r") as f:
        raw = json.load(f)
        
    materialized_invoices = []
    materialized_payments = []
    pay_idx = 1
    
    for inv in raw["invoices_relative"]:
        issue_date = (reference_date + timedelta(days=inv["issue_offset_days"])).isoformat()
        due_date = (reference_date + timedelta(days=inv["due_offset_days"])).isoformat()
        
        paid_sum = sum(p["amount"] for p in inv["payments"])
        outstanding = round(inv["total_amount"] - paid_sum, 2)
        
        if inv["status_override"] == "void":
            status = "void"
        elif outstanding <= 0:
            status = "paid"
        elif paid_sum > 0:
            status = "partially_paid"
        else:
            status = "open"
            
        materialized_invoices.append({
            "id": inv["invoice_id"],
            "invoice_no": inv["invoice_no"],
            "client_id": inv["client_id"],
            "project_id": inv["project_id"],
            "milestone_id": inv["milestone_id"],
            "source": inv["source"],
            "issue_date": issue_date,
            "due_date": due_date,
            "total_amount": inv["total_amount"],
            "status": status
        })
        
        for p in inv["payments"]:
            rec_date = (reference_date + timedelta(days=p["offset_days"])).isoformat()
            materialized_payments.append({
                "id": f"PAY-{pay_idx:02d}",
                "invoice_id": inv["invoice_id"],
                "amount": p["amount"],
                "received_date": rec_date,
                "type": p["type"],
                "recorded_by": "USR-02"
            })
            pay_idx += 1
            
    return {
        "generated_for_date": reference_date.isoformat(),
        "rules": raw["rules"],
        "client_followup_profiles": raw["client_followup_profiles"],
        "invoices": materialized_invoices,
        "payment_records": materialized_payments
    }

if __name__ == "__main__":
    output = materialize_seed_data()
    with open("materialized_seed_output.json", "w") as f:
        json.dump(output, f, indent=2)
    print(f"Materialized {len(output['invoices'])} invoices and {len(output['payment_records'])} payments for {output['generated_for_date']}.")
