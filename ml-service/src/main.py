from pathlib import Path
from typing import Literal
import joblib, pandas as pd
from fastapi import FastAPI,HTTPException
from pydantic import BaseModel,Field
try:
    from .schemes import SCHEMES
except ImportError:
    from schemes import SCHEMES
ROOT=Path(__file__).resolve().parents[1]; PATH=ROOT/'models/eligibility_model.joblib'; app=FastAPI(title='SchemeAI ML Service'); model=None

# Configurable eligibility threshold
ELIGIBILITY_THRESHOLD = 0.70

class Profile(BaseModel):
 age:int=Field(ge=1,le=120); gender:Literal['Male','Female','Other']; maritalStatus:Literal['Single','Married','Widowed','Divorced']; disabilityStatus:bool; casteCategory:Literal['General','OBC','PVTG','SC','ST','DNT','EWS']; familyIncome:float|None=None; parentGuardianIncome:float|None=None; employmentStatus:str; occupation:str=''; bplStatus:bool; isInHardship:bool=False; isStudent:bool; isGovernmentEmployee:bool=False; qualification:str; collegeType:str; state:str; district:str; areaType:Literal['Rural','Urban']; isFarmer:bool; isWidow:bool; isSeniorCitizen:bool; isMinority:bool; isStartupOwner:bool; skillDevelopmentInterest:bool; isArtisan:bool; isAnimalHusbandryOrFisheries:bool

def load():
 global model
 if model is None:
  if not PATH.exists(): raise HTTPException(503,'Model is not trained yet. Run scripts/train_model.py first.')
  try:
   model=joblib.load(PATH)
  except Exception as e:
   raise HTTPException(500,f'Failed to load model: {str(e)}')
 return model

@app.get('/health')
def health(): return {'ok':True,'model_ready':PATH.exists()}

@app.post('/predict')
def predict(profile:Profile):
 ui_schemes = [s for s in SCHEMES]
 if len(ui_schemes) == 0:
  return {'predictions': []}
 b=load()
 try:
  data={k:int(v) if isinstance(v,bool) else v for k,v in profile.model_dump().items()}
  f_inc = data.get('familyIncome')
  p_inc = data.get('parentGuardianIncome')
  if f_inc is None or f_inc == 100_000_001:
      if p_inc is not None and p_inc != 100_000_001:
          data['familyIncome'] = p_inc
      else:
          data['familyIncome'] = 100_000_001
  if p_inc is None or p_inc == 100_000_001:
      data['parentGuardianIncome'] = 0
  rows_to_predict = [{**data,'scheme_id':s['id']} for s in ui_schemes]
  frame=pd.DataFrame(rows_to_predict)[b['feature_columns']]
  probs=b['pipeline'].predict_proba(frame)[:,1]
 except Exception as e:
  raise HTTPException(500, f"XGBoost model prediction failed: {str(e)}")
 
 predictions = []
 for s,p in zip(ui_schemes,probs,strict=True):
  prob_val = round(float(p),4)
  score_val = round(prob_val * 100)
  if prob_val >= ELIGIBILITY_THRESHOLD:
      status_val = 'eligible'
  elif prob_val >= 0.40:
      status_val = 'partial'
  else:
      status_val = 'not_eligible'
  predictions.append({
   'scheme_id': s['id'],
   'probability': prob_val,
   'score': score_val,
   'status': status_val
  })
 predictions.sort(key=lambda x: x['probability'], reverse=True)
 return {'predictions': predictions}

import subprocess
import sys

@app.on_event("startup")
def startup_event():
    from pathlib import Path
    root_dir = Path(__file__).resolve().parents[1]
    gen_script = str(root_dir / "scripts" / "generate_dataset.py")
    train_script = str(root_dir / "scripts" / "train_model.py")
    print(f"Auto-training XGBoost model on startup. Script dir: {root_dir}")
    try:
        subprocess.run([sys.executable, gen_script, "--users", "3000"], check=True, cwd=str(root_dir))
        subprocess.run([sys.executable, train_script], check=True, cwd=str(root_dir))
        print("XGBoost model training completed successfully!")
    except Exception as e:
        print("Auto-training failed on startup:", e)
