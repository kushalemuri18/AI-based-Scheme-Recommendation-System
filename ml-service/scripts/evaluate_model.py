#!/usr/bin/env python3
import json
from pathlib import Path
import joblib
import pandas as pd
from sklearn.metrics import precision_recall_fscore_support, confusion_matrix
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[1]
DROP = {'profile_id', 'fullName', 'scheme_name', 'eligible', 'partial', 'eligibility_score', 'status', 'matched_criteria', 'missed_criteria'}

def main():
    dataset_path = ROOT / 'data/dataset.csv'
    model_path = ROOT / 'models/eligibility_model.joblib'
    
    if not dataset_path.exists():
        print(f"Dataset not found at {dataset_path}")
        return
    if not model_path.exists():
        print(f"Model not found at {model_path}")
        return
        
    print("Loading dataset...")
    d = pd.read_csv(dataset_path)
    f = [c for c in d if c not in DROP]
    
    print("Loading model...")
    b = joblib.load(model_path)
    pipe = b['pipeline']
    
    print("Applying profile-level split to isolate test profiles...")
    unique_profiles = d['profile_id'].unique()
    _, test_profiles = train_test_split(unique_profiles, test_size=0.2, random_state=42)
    test_mask = d['profile_id'].isin(test_profiles)
    test_df = d[test_mask]
    
    X_test = test_df[b['feature_columns']]
    y_test = test_df['eligible'].astype(int)
    
    print("Predicting eligibility using the trained pipeline...")
    y_pred = pipe.predict(X_test)
    
    # Calculate overall metrics on test split
    overall_p, overall_r, overall_f1, _ = precision_recall_fscore_support(
        y_test, y_pred, average='binary', zero_division=0
    )
    print(f"\n=== Overall Test Split Metrics ===")
    print(f"Accuracy:  {(y_pred == y_test).mean():.4f}")
    print(f"Precision: {overall_p:.4f}")
    print(f"Recall:    {overall_r:.4f}")
    print(f"F1-Score:  {overall_f1:.4f}")
    print(f"Support:   {len(y_test)}")
    
    print("\n=== Per-Scheme Performance Evaluation ===")
    print(f"{'Scheme ID':<50} | {'Prec':<6} | {'Rec':<6} | {'F1':<6} | {'Support':<8} | {'Pos Rate':<8} | {'Conf Matrix (TN/FP/FN/TP)':<20}")
    print("-" * 125)
    
    scheme_ids = test_df['scheme_id'].unique()
    for s_id in sorted(scheme_ids):
        scheme_mask = test_df['scheme_id'] == s_id
        y_test_s = y_test[scheme_mask]
        y_pred_s = y_pred[scheme_mask]
        
        prec, rec, f1, _ = precision_recall_fscore_support(
            y_test_s, y_pred_s, average='binary', zero_division=0
        )
        
        support = len(y_test_s)
        pos_rate = y_test_s.mean()
        
        tn, fp, fn, tp = confusion_matrix(y_test_s, y_pred_s, labels=[0, 1]).ravel()
        matrix_str = f"TN:{tn} FP:{fp} FN:{fn} TP:{tp}"
        
        print(f"{s_id:<50} | {prec:<6.4f} | {rec:<6.4f} | {f1:<6.4f} | {support:<8} | {pos_rate:<8.2%} | {matrix_str}")

if __name__ == '__main__':
    main()
