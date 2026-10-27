import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authSource = readFileSync(
  new URL("./customer-auth-page.tsx", import.meta.url),
  "utf8",
);
const favoriteSource = readFileSync(
  new URL("./property-favorite-button.tsx", import.meta.url),
  "utf8",
);
const profileSource = readFileSync(
  new URL("../booking/customer-bookings-profile.tsx", import.meta.url),
  "utf8",
);
const followupSource = readFileSync(
  new URL("../booking/booking-followup-client.tsx", import.meta.url),
  "utf8",
);
const propertyDetailsSource = readFileSync(
  new URL("../../components/property-details-client.tsx", import.meta.url),
  "utf8",
);
const headerSource = readFileSync(
  new URL("../../components/header.tsx", import.meta.url),
  "utf8",
);
const contactMenuSource = readFileSync(
  new URL("../contact/contact-identity-menu.tsx", import.meta.url),
  "utf8",
);

test("customer auth redirects only from a server-resolved identity", () => {
  assert.match(
    authSource,
    /const hasResolvedIdentity = hasServerResolvedContactIdentity\(identity\)/,
  );
  assert.match(
    authSource,
    /hasResolvedIdentity\s+&& identity\.data\?\.kind === "client"/,
  );
  assert.match(
    authSource,
    /if \(!isHydrated \|\| \(!hasResolvedIdentity && \(identity\.isPending \|\| identity\.isFetching\)\)\)/,
  );
});

test("favorite buttons wait for identity while settled guests keep a normal heart", () => {
  assert.match(
    favoriteSource,
    /const isCustomer = hasResolvedIdentity[\s\S]*?identity\.data\?\.kind === "client"[\s\S]*?Boolean\(customerSessionScope\)/,
  );
  assert.match(favoriteSource, /await identity\.refetch\(\)/);
  assert.match(
    favoriteSource,
    /if \(!hasServerResolvedContactIdentity\(refreshedIdentity\)\) return/,
  );
  assert.match(
    favoriteSource,
    /const requestSessionScope = customerSessionCacheScopeForIdentity\([\s\S]*?resolvedIdentity[\s\S]*?\)/,
  );
  assert.match(
    favoriteSource,
    /queryClient\.fetchQuery\([\s\S]*?customerProfileQueryKey\(requestSessionScope\)[\s\S]*?fetchCustomerProfile\(requestSessionScope\)/,
  );
  assert.match(
    favoriteSource,
    /favoriteAtClick = refreshedProfile\.favoritePropertyNumbers[\s\S]*?\.includes\(propertyNumber\)/,
  );
  assert.match(
    favoriteSource,
    /favorite: !favoriteAtClick,[\s\S]*?sessionScope: requestSessionScope/,
  );
  assert.match(
    favoriteSource,
    /\|\| \(isCustomer && \(profile\.isPending \|\| profile\.isFetching\)\)/,
  );
  assert.match(favoriteSource, /disabled=\{isBusy\}/);
});

test("the profile is identity-gated and exposes the existing phone-change dialog", () => {
  assert.match(
    profileSource,
    /useCustomerProfileQuery\(isCustomer, customerSessionScope\)/,
  );
  assert.match(
    profileSource,
    /queryKey: customerHistoryQueryKey\(customerSessionScope\),[\s\S]*?enabled: isCustomer/,
  );
  assert.match(profileSource, /!hasResolvedIdentity\s+\|\| !isCustomer/);
  assert.match(profileSource, />\s*تغيير رقم التواصل\s*<\/Button>/);
  assert.match(profileSource, /mode="change"/);
  assert.match(profileSource, /currentMaskedPhone=\{profile\.maskedPhone\}/);
  assert.match(
    profileSource,
    /onSubmit=\{async \(\) => \{\s*setIsVerificationOpen\(false\);\s*\}\}\s*mode="profile"/,
  );
  assert.match(
    profileSource,
    /enabled: section === "favorites" && favoritePropertyNumbers\.length > 0/,
  );
});

test("the header never renders a storage-only customer identity", () => {
  assert.match(
    headerSource,
    /hasResolvedContactIdentity = hasServerResolvedContactIdentity\(contactIdentityQuery\)/,
  );
  assert.match(
    headerSource,
    /const contactIdentity = hasResolvedContactIdentity[\s\S]*?\? contactIdentityQuery\.data[\s\S]*?: undefined/,
  );
  assert.match(
    headerSource,
    /useCustomerProfileQuery\([\s\S]*?contactIdentity\?\.kind === "client"[\s\S]*?customerSessionScope/,
  );
  assert.match(
    headerSource,
    /customerName=\{customerName\}/,
  );
});

test("the customer header uses the saved name and links every dashboard section", () => {
  assert.match(
    contactMenuSource,
    /const displayName = customerName\?\.trim\(\) \|\| null/,
  );
  assert.match(
    contactMenuSource,
    /\{displayName \|\| identity\.maskedPhone \|\| "رقم محفوظ"\}/,
  );
  assert.match(contactMenuSource, /href="\/profile"/);
  assert.match(contactMenuSource, /href="\/profile\?section=favorites"/);
  assert.match(contactMenuSource, /href="\/profile\?section=account"/);
});

test("same-tab customer changes use the complete customer cache boundary", () => {
  assert.match(followupSource, /resetCustomerSessionQueries\(queryClient\)/);
  assert.doesNotMatch(
    propertyDetailsSource,
    /setQueryData\(CONTACT_IDENTITY_QUERY_KEY/,
  );
  assert.equal(
    propertyDetailsSource.match(
      /await commitContactIdentityCache\(queryClient, EMPTY_CONTACT_IDENTITY\)/g,
    )?.length,
    2,
  );
});
