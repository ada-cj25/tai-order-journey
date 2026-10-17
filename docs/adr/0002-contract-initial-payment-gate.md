# Separate deposit and prepayment behind one contract gate

A new formal sales order records deposit and prepayment as separate immutable payment facts because their dates and evidence can differ, but finance confirms both in one atomic contract-stage action before design begins. Tail receivable subtracts both confirmed facts; existing orders retain the former single-deposit policy so migration never invents a historical prepayment.
