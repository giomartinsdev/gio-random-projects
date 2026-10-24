# infra

Duas configs Terraform, nada mais:

- **`terraform/`** — gerencia o **Cloudflare** (DNS, Zero Trust Access,
  service tokens, mTLS do registry) e a **baseline do host** (firewall,
  pacotes, sysctl). Aplicado por `.github/workflows/tf-ci-cd.yml`.
- **`terraform-bootstrap/`** — o que `terraform/` não pode gerenciar porque é
  o que faz aquela config funcionar: o bucket R2 onde o state mora. Aplicado à
  mão, uma vez, com state local.

## O que o Terraform NÃO gerencia (e por quê)

Workloads. Nada de container, pod, Deployment ou Service — isso é
`k8s/apps/`, reconciliado pelo ArgoCD. O provider `docker` foi removido
quando a era Docker Compose acabou; hoje não existe nada rodando em Docker no
host.

A fronteira é deliberada:

| camada | dono |
| --- | --- |
| DNS, TLS do edge, Access, firewall do host | Terraform |
| namespace, Deployment, Service, Ingress, PVC, Secret de app | ArgoCD (via `k8s/`) |
| imagem (build, push, digest) | GitHub Actions |

O Terraform e o ArgoCD não se aplicam em sequência automática: são planos
independentes. O único acoplamento é o DNS — um hostname novo precisa de A
record aqui **antes** do Ingress existir, senão o Cloudflare responde 522.

## Módulos

```
modules/
  cloud/cloudflare/          DNS, Access, service tokens, mTLS, email routing
  compute/services/host_baseline/  firewall, pacotes, sysctl do host
```

## Rodar local

```bash
cd infra/terraform
terraform init
terraform plan      # precisa TF_VAR_* — ver README do módulo
```

O CI usa as mesmas variáveis via environment `production` (required reviewers).
Nunca dê `apply` local em `terraform/`: o state é remoto (R2) e o lock vai
brigar com o CI.
