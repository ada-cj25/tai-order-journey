type PreservedForm = {
  validateFields: () => Promise<Record<string, unknown>>;
  getFieldsValue: (allValues: true) => Record<string, unknown>;
};

export async function collectPreservedFormValues(form: PreservedForm) {
  await form.validateFields();
  return form.getFieldsValue(true);
}
