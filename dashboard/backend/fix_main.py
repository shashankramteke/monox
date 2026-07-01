import sys

def fix_file():
    with open("main.py.bak", "r", encoding="utf-8") as f:
        content = f.read()
    
    # The original file was truncated right before this line
    marker = '    # ── Raw anomaly event JSON (complete context for LLM) ───────────\n    event_json = json.dumps(event.model_dump(), indent=2, default=str)'
    
    idx = content.find(marker)
    if idx == -1:
        print("Marker not found in original file.")
        sys.exit(1)
        
    good_part = content[:idx + len(marker)]
    
    rest_of_file = """

    prompt = f\"\"\"You are MonoXAI, an expert SRE root-cause-analysis engine.
Analyze the following anomaly event and produce a precise diagnosis.

═══ ANOMALY SUMMARY ═══════════════════════════════════════════════
Type            : {anomaly_type}
Service         : {service}
Route           : {route}
Duration        : {duration_ms:.1f} ms
Anomaly Score   : {anomaly_score:.4f}
Timestamp       : {timestamp}
Span Count      : {span_count} (errors: {error_count})
Unique Services : {', '.join(unique_services)}
Span Durations  : min={min_span_dur:.0f}ms  avg={avg_span_dur:.0f}ms  max={max_span_dur:.0f}ms

═══ RULE DETECTORS FIRED ══════════════════════════════════════════
{detectors_block}

═══ ML ENSEMBLE SCORES ════════════════════════════════════════════
{ml_block}

═══ DEPENDENCY CHAIN ══════════════════════════════════════════════
{dep_block}

Dangling Parents:
{dangling_block}

═══ SPAN INVENTORY (first 20) ═════════════════════════════════════
{spans_block}

═══ CORRELATED LOGS ═══════════════════════════════════════════════
{logs_block}

═══ RAW EVENT JSON ════════════════════════════════════════════════
{event_json}

═══ INSTRUCTIONS ══════════════════════════════════════════════════
1. Identify the root cause by correlating fired detectors, ML scores,
   span structure, dependency chain, and correlated logs.
2. Suggest 3 concrete, actionable fixes (not generic advice).
3. Predict the business-level risk if the issue is left unresolved.

Respond as STRICT JSON (no markdown fences, no commentary outside JSON):
{{
  "root_cause": "concise explanation tied to fired detectors and structural evidence (max 30 words)",
  "suggested_fixes": ["concrete fix 1", "concrete fix 2", "concrete fix 3"],
  "risk_prediction": "one-sentence impact if left unresolved",
  "confidence": 0.0-1.0
}}
\"\"\"

    try:
        response = model.generate_content(prompt)
        text = response.text.strip()
        # Handle potential markdown formatting from AI
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].strip()
        return json.loads(text)
    except Exception as e:
        import asyncio
        # Throttle output loop (every 1.0s for smooth graph animation)
        await asyncio.sleep(1.0)
        logger.error(f"RCA analysis failed for trace {trace_id}: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=f"AI analysis failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
"""
    
    with open("main.py", "w", encoding="utf-8") as f:
        f.write(good_part + rest_of_file)
        
if __name__ == "__main__":
    fix_file()
