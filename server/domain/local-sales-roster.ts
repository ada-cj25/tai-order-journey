export const LOCAL_SALES = [
  { employeeNo: "S101", username: "noerlisales1", name: "诺尔丽测试销售员1", department: "诺尔丽销售部", businessUnit: "NOERLI", supervisor: "salesmanager" },
  { employeeNo: "S102", username: "noerlisales2", name: "诺尔丽测试销售员2", department: "诺尔丽销售部", businessUnit: "NOERLI", supervisor: "salesmanager" },
  { employeeNo: "S201", username: "aikejusales1", name: "艾可居测试销售员1", department: "艾可居销售部", businessUnit: "AIKEJU", supervisor: "aikejumgr" },
  { employeeNo: "S202", username: "aikejusales2", name: "艾可居测试销售员2", department: "艾可居销售部", businessUnit: "AIKEJU", supervisor: "aikejumgr" },
].map((employee) => ({ ...employee, role: "SALES" as const, level: "STAFF" }));
