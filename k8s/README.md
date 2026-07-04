# Deploying MonoXAI on Kubernetes

The dashboard ships as a single self-contained container (same image as the
Hugging Face Space), so running it on a real cluster is four commands:

```bash
# 1. Build & push the image (staging dir is created by deploy/deploy_hf.py,
#    or copy dashboard/backend + static manually per deploy/Dockerfile)
docker build -t <registry>/monoxai:latest deploy/_space_build
docker push <registry>/monoxai:latest

# 2. Point the Deployment at your image
#    (edit image: in deployment.yaml)

# 3. Create namespace + optional Gemini secret
kubectl apply -f k8s/namespace.yaml
kubectl -n monoxai create secret generic monoxai-secrets \
  --from-literal=gemini-api-key=<YOUR_GEMINI_KEY>

# 4. Deploy
kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml -f k8s/hpa.yaml
kubectl -n monoxai port-forward svc/monoxai-dashboard 8080:80
# open http://localhost:8080
```

Note: the **Kubernetes view inside the dashboard** is a built-in cluster
simulator (nodes/pods/events/HPA) so the demo works anywhere — it does not
require these manifests. These manifests are for hosting the app itself on a
real cluster.
