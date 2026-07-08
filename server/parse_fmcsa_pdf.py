#!/usr/bin/env python3
"""
FMCSA Daily Publications PDF Parser
Takes a PDF URL as argument, downloads it, parses carrier data by category,
and outputs structured JSON to stdout.
"""

import requests
import pdfplumber
import pandas as pd
import io
import sys
import json

def parse_fmcsa_pdf(pdf_content):
    """Parse FMCSA PDF content and return structured data with categories."""
    all_data = []
    current_section = "Unknown Section"
    
    VALID_CATEGORIES = [
        "BROKER OF HOUSEHOLD GOODS",
        "BROKER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
        "FREIGHT FORWARDER OF HOUSEHOLD GOODS",
        "FREIGHT FORWARDER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
        "MOTOR CARRIER OF HOUSEHOLD GOODS",
        "MOTOR CARRIER OF PROPERTY (EXCEPT HOUSEHOLD GOODS)",
        "MOTOR CARRIER OF PASSENGERS",
        "FITNESS-ONLY APPLICATIONS"
    ]

    with pdfplumber.open(io.BytesIO(pdf_content)) as pdf:
        for page in pdf.pages:
            # 1. Find all section headers and their vertical positions
            headers = []
            text_lines = page.extract_text_lines()
            for line in text_lines:
                line_text = line['text'].strip().upper()
                for cat in VALID_CATEGORIES:
                    if cat == line_text:
                        headers.append({'section': cat, 'top': line['top']})
            
            # Sort headers by vertical position
            headers.sort(key=lambda x: x['top'])
            
            # 2. Extract tables and their vertical positions
            tables = page.find_tables()
            for table in tables:
                table_top = table.bbox[1]
                
                # Determine the section for this table
                table_section = current_section
                for h in headers:
                    if h['top'] < table_top:
                        table_section = h['section']
                    else:
                        break
                
                # Update current_section for next tables/pages
                current_section = table_section
                
                # Extract data from the table
                data = table.extract()
                for row in data:
                    # Clean the row
                    clean_row = [str(cell).replace('\n', ' ').strip() if cell else "" for cell in row]
                    
                    # Skip header rows and empty rows
                    if not any(clean_row):
                        continue
                    if "USDOT Number" in clean_row or "Legal Business Name" in clean_row:
                        continue
                    
                    # Add section column
                    all_data.append([table_section] + clean_row)

    # Define headers
    headers_list = ["Section", "USDOT Number", "Legal Business Name", "Filing Date", "Mailing Address", "Company Officer", "Telephone"]
    
    df = pd.DataFrame(all_data)
    if not df.empty:
        # Trim to match headers
        df = df.iloc[:, :len(headers_list)]
        df.columns = headers_list
        
    return df


def main():
    """Main entry point - takes PDF URL as argument."""
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "No PDF URL provided", "entries": []}))
        sys.exit(1)
    
    pdf_url = sys.argv[1]
    
    try:
        # Download PDF
        response = requests.get(pdf_url, timeout=60, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        response.raise_for_status()
        
        # Parse PDF
        df_result = parse_fmcsa_pdf(response.content)
        
        if not df_result.empty:
            # Convert to list of dicts for JSON output
            entries = df_result.to_dict(orient='records')
            
            # Clean up entries - remove rows where USDOT is empty
            clean_entries = []
            for entry in entries:
                usdot = str(entry.get("USDOT Number", "")).strip()
                if usdot and usdot != "" and usdot != "None":
                    clean_entries.append({
                        "usdot_number": usdot,
                        "legal_business_name": str(entry.get("Legal Business Name", "")).strip(),
                        "filing_date": str(entry.get("Filing Date", "")).strip(),
                        "mailing_address": str(entry.get("Mailing Address", "")).strip(),
                        "company_officer": str(entry.get("Company Officer", "")).strip(),
                        "telephone": str(entry.get("Telephone", "")).strip(),
                        "category": str(entry.get("Section", "Unknown")).strip()
                    })
            
            print(json.dumps({
                "success": True,
                "count": len(clean_entries),
                "pdf_url": pdf_url,
                "entries": clean_entries
            }))
        else:
            print(json.dumps({
                "success": True,
                "count": 0,
                "pdf_url": pdf_url,
                "entries": [],
                "message": "No data found in the PDF"
            }))
            
    except requests.exceptions.RequestException as e:
        print(json.dumps({
            "success": False,
            "error": f"Failed to download PDF: {str(e)}",
            "entries": []
        }))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({
            "success": False,
            "error": f"PDF parsing error: {str(e)}",
            "entries": []
        }))
        sys.exit(1)


if __name__ == "__main__":
    main()
