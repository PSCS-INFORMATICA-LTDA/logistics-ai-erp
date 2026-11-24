-- DEV only. Não aplicar sem autorização explícita no Supabase DEV jmbajdpkvlrslirwzyze.
-- Não aplicar em PROD tqeenmswotxqainkyyct.
-- Restringe o seed do plano de contas a administrador e financeiro,
-- pela função já existente auth_user_can_access_company_finance.
-- Não altera o seed de tarifas: qualquer membro da empresa continua podendo inicializar a tarifa.

CREATE OR REPLACE FUNCTION public.seed_chart_of_accounts(p_company_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $seed_chart$
DECLARE
    v_inserted INTEGER;
BEGIN
  -- Administrador ou financeiro. A tarifa continua disponível a qualquer membro.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.auth_user_can_access_company_finance(p_company_id) THEN
    RAISE EXCEPTION 'Sem permissão para inicializar o plano de contas desta empresa'
      USING ERRCODE = '42501';
  END IF;

    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
        RAISE EXCEPTION 'Empresa não encontrada: %', p_company_id;
    END IF;

    INSERT INTO public.chart_of_accounts (company_id, name, classification, transaction_type, status)
    SELECT p_company_id, v.name, v.classification, v.transaction_type, 'Ativo'
    FROM (VALUES
        ('Água', 'Ocupação', 'Despesa'),
        ('Ajudante', 'Operacional', 'Despesa'),
        ('Alimentação', 'Administrativo', 'Despesa'),
        ('Aluguel', 'Ocupação', 'Despesa'),
        ('Andaimes - Aquisição', 'Administrativo', 'Despesa'),
        ('Andaimes - Locação', 'Receitas', 'Receita'),
        ('Aquisição de bens', 'Operacional', 'Despesa'),
        ('Assinaturas', 'TI', 'Despesa'),
        ('Bebidas - Geladeira', 'Administrativo', 'Despesa'),
        ('Benefícios', 'RH', 'Despesa'),
        ('Brindes', 'Marketing', 'Despesa'),
        ('Caminhão agregado', 'Operacional', 'Despesa'),
        ('Cartórios/Tabelião', 'Administrativo', 'Despesa'),
        ('Comissão', 'Lavagens', 'Despesa'),
        ('Consórcio', 'Administrativo', 'Despesa'),
        ('Coordenador', 'Administrativo', 'Despesa'),
        ('Correios', 'Administrativo', 'Despesa'),
        ('Cursos e treinamentos', 'RH', 'Despesa'),
        ('Custo caminhão refrigerado', 'Operacional', 'Despesa'),
        ('Custo micro Ônibus agregado', 'Operacional', 'Despesa'),
        ('Custo ônibus agregado', 'Operacional', 'Despesa'),
        ('Desconto de Multas - Motoristas', 'Receitas', 'Receita'),
        ('Despesas bancárias', 'Finanças', 'Despesa'),
        ('Despesas com transporte', 'Operacional', 'Despesa'),
        ('Documentação Caminhão', 'Administrativo', 'Despesa'),
        ('Documentação Vans', 'Administrativo', 'Despesa'),
        ('Empréstimos e financiamentos', 'Finanças', 'Despesa'),
        ('Endomarketing', 'Marketing', 'Despesa'),
        ('Energia elétrica', 'Ocupação', 'Despesa'),
        ('Estacionamento', 'Administrativo', 'Despesa'),
        ('Fornecedor de marketing', 'Marketing', 'Despesa'),
        ('Fornecedor de TI', 'TI', 'Despesa'),
        ('Fornecimento de àgua', 'Ocupação', 'Despesa'),
        ('Gráfica e copiadora', 'Administrativo', 'Despesa'),
        ('Hospedagem', 'Administrativo', 'Despesa'),
        ('Impostos', 'Taxas e Tributos', 'Despesa'),
        ('Internet', 'TI', 'Despesa'),
        ('KM', 'Administrativo', 'Despesa'),
        ('Limpeza e conservação', 'Ocupação', 'Despesa'),
        ('Manutenção de bens', 'Operacional', 'Despesa'),
        ('Manutenção e reforma', 'Ocupação', 'Despesa'),
        ('Materiais de lava rápido', 'Administrativo', 'Despesa'),
        ('Materiais de TI', 'TI', 'Despesa'),
        ('Material de escritório', 'Administrativo', 'Despesa'),
        ('Material de limpeza e cozinha', 'Ocupação', 'Despesa'),
        ('Motoboy', 'Administrativo', 'Despesa'),
        ('Motorista', 'Operacional', 'Despesa'),
        ('Móveis e utensílios', 'Ocupação', 'Despesa'),
        ('Multas e juros', 'Finanças', 'Despesa'),
        ('Pagamento de BV', 'Administrativo', 'Despesa'),
        ('Pedágio', 'Administrativo', 'Despesa'),
        ('Posto de Combustível', 'Administrativo', 'Despesa'),
        ('Prospecção', 'Marketing', 'Despesa'),
        ('Receita Caminhão', 'Receitas', 'Receita'),
        ('Receita Caminhão Refrigerado', 'Receitas', 'Receita'),
        ('Receita diversas', 'Receitas', 'Receita'),
        ('Receita Estacionamento', 'Receitas', 'Receita'),
        ('Receita Lava Rápido', 'Receitas', 'Receita'),
        ('Receita micro ônibus agregado', 'Receitas', 'Receita'),
        ('Receita ônibus agregado', 'Receitas', 'Receita'),
        ('Receita Van', 'Receitas', 'Receita'),
        ('Reembolso', 'Administrativo', 'Despesa'),
        ('Salários', 'RH', 'Despesa'),
        ('Saldo Inicial', 'Receitas', 'Receita'),
        ('Seguros', 'Ocupação', 'Despesa'),
        ('Serviços contábeis', 'Finanças', 'Despesa'),
        ('Serviços de consultoria', 'Operacional', 'Despesa'),
        ('Taxas e emolumentos', 'Administrativo', 'Despesa'),
        ('Táxi/Uber', 'Administrativo', 'Despesa'),
        ('Telefonia', 'TI', 'Despesa'),
        ('Transferências bancárias', 'Movimentações', 'Outros'),
        ('Transporte público', 'Administrativo', 'Despesa'),
        ('Van agregada', 'Operacional', 'Despesa'),
        ('Venda de bebidas e salgadinhos', 'Receitas', 'Receita'),
        ('Vendas Bebidas - Geladeira', 'Receitas', 'Receita'),
        ('Vendas Litle Tress', 'Receitas', 'Receita'),
        ('Caminhão 1', 'Receitas', 'Receita'),
        ('Caminhão 2', 'Receitas', 'Receita'),
        ('Caminhão 3', 'Receitas', 'Receita'),
        ('Van 1', 'Receitas', 'Receita'),
        ('Van 2', 'Receitas', 'Receita')
    ) AS v(name, classification, transaction_type)
    ON CONFLICT (company_id, name) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN v_inserted;
END;
$seed_chart$;

COMMENT ON FUNCTION public.seed_chart_of_accounts(UUID) IS
  'Popula o plano de contas da empresa se auth.uid() for administrador ou financeiro dela.';
