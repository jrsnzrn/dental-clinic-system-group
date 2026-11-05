# Overall System Flowchart

This flowchart presents TopDent's implemented authentication, role-specific modules, and the shared patient appointment, treatment, dental chart, and payment lifecycle.

```mermaid
flowchart TD
    START([Start]) --> OPEN["Open TopDent System"]
    OPEN --> LOGIN["Login"]
    LOGIN --> METHOD{"Sign-in method?"}
    METHOD -- "Staff: email and password" --> STAFF_AUTH["Authenticate staff credentials"]
    METHOD -- "Patient: Google sign-in" --> PATIENT_AUTH["Authenticate patient with Google"]

    STAFF_AUTH --> STAFF_VALID{"Credentials valid?"}
    STAFF_VALID -- No --> AUTH_ERROR["Display sign-in or account error"]
    STAFF_VALID -- Yes --> STAFF_PROFILE["Load admins/{uid}; validate staff role"]
    STAFF_PROFILE --> STAFF_ACTIVE{"Role valid and account enabled?"}
    STAFF_ACTIVE -- No --> AUTH_ERROR
    STAFF_ACTIVE -- Yes --> EMAIL_VERIFIED{"Staff email verified?"}
    EMAIL_VERIFIED -- No --> VERIFY_EMAIL["Complete staff email verification"]
    EMAIL_VERIFIED -- Yes --> MFA_REQUIRED{"MFA required?"}
    VERIFY_EMAIL --> MFA_REQUIRED
    MFA_REQUIRED -- Yes --> VERIFY_MFA["Complete staff MFA verification"]
    MFA_REQUIRED -- No --> ROLE["Identify user role"]
    VERIFY_MFA --> MFA_VALID{"MFA verification successful?"}
    MFA_VALID -- No --> VERIFY_MFA
    MFA_VALID -- Yes --> ROLE

    PATIENT_AUTH --> PATIENT_AUTH_VALID{"Google sign-in successful?"}
    PATIENT_AUTH_VALID -- No --> AUTH_ERROR
    PATIENT_AUTH_VALID -- Yes --> ROLE
    AUTH_ERROR --> LOGIN

    subgraph PATIENT["Patient"]
        direction TB
        P_PROFILE["Complete or update patient profile"]
        P_BOOK["Choose service, dentist, date, and available time"]
        P_SUBMIT["Submit appointment request<br/>Booking status: Pending"]
        P_STATUS["View appointment status; request reschedule or cancellation when eligible"]
        P_APPROVED{"Appointment approved?"}
        P_ARRIVE["Attend approved appointment"]
        P_RECORDS["View Dental Records, FDI chart, treatment history, and payment receipts"]
        P_EXIT["Finish patient activities"]
        P_PROFILE --> P_BOOK --> P_SUBMIT
        P_STATUS --> P_APPROVED
        P_APPROVED -- Yes --> P_ARRIVE
        P_APPROVED -- No --> P_EXIT
    end

    subgraph RECEPTIONIST["Receptionist"]
        direction TB
        R_DASH["Review daily dashboard and appointment requests"]
        R_REVIEW["Review pending appointment"]
        R_APPROVE{"Approve appointment?"}
        R_APPROVED["Set booking status: Approved"]
        R_CANCEL["Cancel appointment"]
        R_CHECKIN["Check in patient and manage clinic queue"]
        R_SUMMARY["Create Pending payment-treatment summary"]
        R_PAYMENT["Review charges; record payment, method, and receipt"]
        R_SETTLED{"Treatment balance fully paid?"}
        R_PARTIAL["Payment status: Pending or Partially Paid"]
        R_PAID["Payment status: Paid<br/>Appointment status: Completed"]
        R_OTHER["Manage patient records, braces payments, archive, and staff settings"]
        R_EXIT["Finish receptionist activities"]
        R_DASH --> R_REVIEW --> R_APPROVE
        R_APPROVE -- Yes --> R_APPROVED
        R_APPROVE -- No --> R_CANCEL
        R_CHECKIN --> R_SUMMARY
        R_PAYMENT --> R_SETTLED
        R_SETTLED -- No --> R_PARTIAL
        R_SETTLED -- Yes --> R_PAID
        R_DASH --> R_OTHER --> R_EXIT
    end

    subgraph DENTIST["Dentist"]
        direction TB
        D_DASH["Review assigned appointments and daily dashboard"]
        D_PATIENT["Open assigned patient record"]
        D_CHART["Update FDI Dental Chart<br/>Record standard or extra-tooth procedures"]
        D_COMPLETE["Mark checked-in treatment complete<br/>Booking status: Pending Payment"]
        D_REVIEW["Review completed treatments and staff settings"]
        D_DASH --> D_PATIENT --> D_CHART --> D_COMPLETE
        D_DASH --> D_REVIEW
    end

    subgraph ADMIN["Admin"]
        direction TB
        A_DASH["Review dashboard and analytics"]
        A_MODULE{"Choose Admin module"}
        A_ACCOUNTS["Manage staff accounts and access"]
        A_CLINIC["Manage dentists, schedules, services, closures, and promotions"]
        A_PATIENTS["Manage patient records and appointments"]
        A_FINANCE["Review regular and braces payments"]
        A_REPORTS["Generate reports; review activity logs and archive"]
        A_EXIT["Finish Admin activities"]
        A_DASH --> A_MODULE
        A_MODULE -- Accounts --> A_ACCOUNTS
        A_MODULE -- "Clinic setup" --> A_CLINIC
        A_MODULE -- "Patients and appointments" --> A_PATIENTS
        A_MODULE -- Payments --> A_FINANCE
        A_MODULE -- "Reports and oversight" --> A_REPORTS
        A_ACCOUNTS --> A_EXIT
        A_CLINIC --> A_EXIT
        A_PATIENTS --> A_EXIT
        A_FINANCE --> A_EXIT
        A_REPORTS --> A_EXIT
    end

    ROLE -- Patient --> P_PROFILE
    ROLE -- Receptionist --> R_DASH
    ROLE -- Dentist --> D_DASH
    ROLE -- Admin --> A_DASH

    P_SUBMIT --> R_REVIEW
    R_APPROVED --> P_STATUS
    R_CANCEL --> P_STATUS
    P_ARRIVE --> R_CHECKIN
    R_SUMMARY --> D_PATIENT
    D_COMPLETE --> R_PAYMENT
    R_PARTIAL --> P_RECORDS
    R_PAID --> P_RECORDS

    P_EXIT --> LOGOUT["Logout"]
    R_EXIT --> LOGOUT
    D_REVIEW --> LOGOUT
    P_RECORDS --> LOGOUT
    A_EXIT --> LOGOUT
    LOGOUT --> FINISH([End])
```

### Workflow notes

- Staff sign in with email and password. The system checks the staff document in `admins/{uid}`, validates the role and enabled status, then requires email verification and MFA when applicable. Patients authenticate with Google and maintain their profile before booking.
- Patient booking requests begin with `Pending`; receptionist approval changes the booking to `Approved`. Receptionist check-in records the check-in and creates pending entries in `paymentTreatmentSummaries`.
- Dentists open assigned patient records, save procedures to the Dental Chart, and mark an eligible checked-in treatment complete. That action moves the booking to `Pending Payment`; it does not represent a separate receptionist treatment-confirmation step.
- Receptionist payment recording updates payment records and their balances. An appointment is marked `Completed` after its treatment balances are fully settled; otherwise payment can remain `Pending` or `Partially Paid`.
- Patient Dental Records read the saved chart and treatment history, while Payment History reads existing treatment and braces receipts. These are separate views of the saved records.
