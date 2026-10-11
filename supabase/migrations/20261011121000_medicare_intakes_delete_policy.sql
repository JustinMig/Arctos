-- Allow authenticated CRM users to delete Medicare intake forms for
-- clients they are permitted to access. Client records are NOT deleted.
CREATE POLICY medicare_intakes_delete
ON public.medicare_intakes
FOR DELETE TO authenticated
USING (private.mig_can_access_client(client_id));
