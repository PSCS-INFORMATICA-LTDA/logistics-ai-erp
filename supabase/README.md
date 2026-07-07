# Supabase — GRX Management V1

## Ordem de execução

No **SQL Editor** do Supabase, execute na sequência:

1. `migrations/001_schema.sql` — tabelas, triggers, views
2. `migrations/002_auth_rls.sql` — profiles, company_members, RLS
3. `migrations/003_seed_chart_of_accounts.sql` — função de seed
4. `migrations/004_vehicle_ownership.sql` — participação societária por veículo (refatoração)
5. `migrations/005_drivers_cnh.sql` — CNH e vencimento no cadastro de motoristas
6. `migrations/006_seed_drivers.sql` — função seed_drivers
7. `migrations/007_drivers_cnh_categories.sql` — categorias da CNH (multi-seleção)
8. `migrations/008_storage_attachments.sql` — bucket Storage para galeria de anexos
9. `migrations/009_service_orders_driver.sql` — motorista em ordem de serviço
10. `migrations/010_traffic_infractions.sql` — infrações de trânsito + `vehicle_id` em OS
11. `migrations/011_traffic_infractions_workflow.sql` — órgão autuador, comprovante e arquivamento
12. `migrations/012_traffic_infractions_plate.sql` — placa espelhada do veículo cadastrado (trigger)
13. `migrations/013_service_orders_categories.sql` — Estacionamento, categorias e conta DRE em OS
14. `migrations/014_service_orders_freight.sql` — Frete, rota A→B, piso ANTT e valor fechado
15. `migrations/015_service_orders_freight_tolls.sql` — quantidade e detalhamento de pedágios
16. `migrations/016_vehicles_axle_count.sql` — quantidade de eixos no cadastro de caminhão
17. `migrations/017_service_orders_status_approval.sql` — status "Aguardando aprovação cliente"
18. `migrations/018_service_orders_per_diem.sql` — despesas de viagem (diárias > 1.000 km)
19. `migrations/019_service_orders_per_diem_charge.sql` — cobrança diária Cliente vs GRX
20. `migrations/020_service_orders_transport_km_rate.sql` — tarifa R$/km para van

## Seed do plano de contas

Após criar a empresa e obter o UUID:

```sql
SELECT public.seed_chart_of_accounts('00000000-0000-0000-0000-000000000000');
```

Retorna quantidade de contas inseridas (81 na primeira execução; duplicatas ignoradas).

## Documentação

Detalhamento de cada tabela: `docs/03_DATABASE.md`
