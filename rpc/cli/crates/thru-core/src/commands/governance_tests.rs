use super::*;
use thru_base::bootstrap_addresses::*;
fn address(n: u8) -> String {
    hex::encode([n; 32])
}
fn input(operation: Operation) -> PlanInput {
    let target = if matches!(&operation, Operation::Abi { .. }) {
        ABI_MANAGER_PROGRAM_BYTES
    } else {
        CORE_MANAGER_PROGRAM_BYTES
    };
    let mut rw = vec![CORE_CONFIG_BYTES, CORE_PEER_CONFIG_BYTES];
    for n in 2..16 {
        rw.push([n; 32]);
    }
    rw.sort();
    rw.dedup();
    let mut ro = vec![
        target,
        MULTISIG_PROGRAM_BYTES,
        CORE_PEER_MANAGER_PROGRAM_BYTES,
    ];
    ro.sort();
    ro.dedup();
    PlanInput {
        wrapper: hex::encode(MULTICALL_PROGRAM_BYTES),
        target_program: hex::encode(target),
        config: hex::encode(CORE_CONFIG_BYTES),
        admin: address(2),
        eoa_admin: false,
        accounts: Accounts {
            read_write: rw.iter().map(hex::encode).collect(),
            read_only: ro.iter().map(hex::encode).collect(),
        },
        operation,
        reviewed_state: json!({"genesis_inventory_sha256":"00".repeat(32),"changes":[]}),
    }
}
#[test]
fn core_policy_tags_and_frozen_lengths() {
    let cases = vec![
        (
            Operation::SetPause {
                metadata: address(3),
                program: address(4),
                paused: true,
            },
            3,
            138,
        ),
        (
            Operation::Destroy {
                metadata: address(3),
                program: address(4),
            },
            4,
            137,
        ),
        (
            Operation::Finalize {
                metadata: address(3),
                program: address(4),
            },
            5,
            137,
        ),
        (
            Operation::SetApplicationAuthority {
                metadata: address(3),
                program: address(4),
                authority: address(5),
            },
            6,
            169,
        ),
        (
            Operation::SetPin {
                target: address(3),
                pin: true,
            },
            7,
            104,
        ),
        (
            Operation::ProposeAdmin {
                candidate: address(3),
                kind: 1,
            },
            8,
            172,
        ),
        (Operation::AcceptAdmin, 9, 137),
    ];
    for (op, tag, len) in cases {
        let bytes = input(op).encode().unwrap();
        assert_eq!(bytes[0], tag);
        assert_eq!(bytes.len(), len);
    }
}
#[test]
fn exact_image_and_source_range_commitment() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut bytes = vec![0; 20];
    bytes[0] = 1;
    fs::write(file.path(), &bytes).unwrap();
    let image = Image {
        source: address(5),
        offset: 13,
        length: 20,
        artifact: file.path().into(),
        sha256: digest(&bytes),
    };
    let plan = Plan::new(input(Operation::Upgrade {
        metadata: address(3),
        program: address(4),
        image: image.clone(),
    }))
    .unwrap();
    let wire = hex::decode(&plan.instruction).unwrap();
    assert_eq!(wire.len(), 211);
    assert_eq!(&wire[171..175], &13u32.to_le_bytes());
    assert_eq!(&wire[179..], &crypto::calculate_sha256(&bytes));
    bytes[9] = 1;
    fs::write(file.path(), bytes).unwrap();
    assert!(plan.validate().is_err());
    let mut overflow = image;
    overflow.offset = u32::MAX;
    assert!(overflow.validate(true).is_err());
}
#[test]
fn create_layout_and_refresh_leave_approval_unchanged() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut bytes = vec![0; 20];
    bytes[0] = 1;
    fs::write(file.path(), &bytes).unwrap();
    let mut seed = [0; 32];
    seed[..8].copy_from_slice(b"coreprf1");
    let slot = ProofSlot {
        address: address(6),
        seed: hex::encode(seed),
        metadata: address(3),
        program: address(4),
    };
    let make = |proof_slot| {
        input(Operation::Create {
            metadata: address(3),
            program: address(4),
            seed: address(9),
            image: Image {
                source: address(5),
                offset: 0,
                length: 20,
                artifact: file.path().into(),
                sha256: digest(&bytes),
            },
            application_authority: address(7),
            pin: true,
            proof_slot,
        })
    };
    assert_eq!(make(None).encode().unwrap().len(), 276);
    let plan = Plan::new(make(Some(slot.clone()))).unwrap();
    assert_eq!(plan.instruction.len() / 2, 342);
    let approved = plan.invoke().unwrap();
    let mut proof = vec![0; 104];
    proof[..8].copy_from_slice(&(2u64 << 62).to_le_bytes());
    let first = write_proof_slot(&plan.input.accounts, &slot, &proof, &proof).unwrap();
    proof[0] = 1;
    let second = write_proof_slot(&plan.input.accounts, &slot, &proof, &proof).unwrap();
    assert_ne!(first, second);
    assert_eq!(approved, plan.invoke().unwrap());
    assert_eq!(first.len(), 75 + 208);
    proof.push(0);
    assert!(write_proof_slot(&plan.input.accounts, &slot, &proof, &proof).is_err());
}
#[test]
fn governed_abi_lifecycle_and_root_are_distinct() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let yaml = include_bytes!("../../abi/tn_token_program.abi.yaml");
    fs::write(file.path(), yaml).unwrap();
    for (action, tag) in [
        (AbiAction::CreateMetaEphemeral, 16),
        (AbiAction::CreateContentEphemeral, 18),
        (AbiAction::Upgrade, 19),
        (AbiAction::Close, 20),
        (AbiAction::Finalize, 21),
        (AbiAction::CorrectRoot, 14),
    ] {
        let root = matches!(action, AbiAction::CorrectRoot);
        let meta = matches!(action, AbiAction::CreateMetaEphemeral);
        let content = matches!(
            action,
            AbiAction::CreateContentEphemeral | AbiAction::Upgrade | AbiAction::CorrectRoot
        );
        let mut p = input(Operation::Abi {
            action,
            subject: if root {
                hex::encode(CORE_MANAGER_PROGRAM_BYTES)
            } else {
                address(4)
            },
            program_metadata: if root { None } else { Some(address(3)) },
            abi_metadata: address(6),
            abi_content: if meta { None } else { Some(address(7)) },
            image: if content {
                Some(Image {
                    source: address(5),
                    offset: 45,
                    length: yaml.len() as u32,
                    artifact: file.path().into(),
                    sha256: digest(yaml),
                })
            } else {
                None
            },
            creation_proof: None,
        });
        if root {
            p.accounts
                .read_only
                .push(hex::encode(CORE_MANAGER_PROGRAM_BYTES));
            p.accounts.read_only.sort_by_key(|a| key(a).unwrap());
        }
        let wire = p.encode().unwrap();
        assert_eq!(wire[0], tag);
        assert_eq!(wire.len(), 279);
        if root {
            assert_eq!(&wire[103..137], &[0; 34]);
        }
    }
}
#[test]
fn layout_and_plan_tampering_rejected() {
    let mut p = input(Operation::AcceptAdmin);
    p.accounts.read_write.push(p.admin.clone());
    assert!(p.encode().is_err());
    let mut plan = Plan::new(input(Operation::AcceptAdmin)).unwrap();
    plan.instruction.push_str("00");
    assert!(plan.validate().is_err());
    let mut p = input(Operation::AcceptAdmin);
    p.target_program = address(99);
    assert!(p.encode().is_err());
}
#[test]
fn rotation_both_directions_bind_candidate() {
    for kind in [1, 2] {
        let p = input(Operation::ProposeAdmin {
            candidate: address(8),
            kind,
        });
        let b = p.encode().unwrap();
        assert_eq!(b[103], kind);
        assert_eq!(&b[71..103], &[8; 32]);
        // Paired rotation (UNTO-3561): Core B and its config follow.
        assert_eq!(&b[106..138], &CORE_PEER_MANAGER_PROGRAM_BYTES);
        assert_eq!(&b[140..172], &CORE_PEER_CONFIG_BYTES);
    }
    let mut missing = input(Operation::AcceptAdmin);
    missing
        .accounts
        .read_write
        .retain(|a| a != &hex::encode(CORE_PEER_CONFIG_BYTES));
    assert!(missing.encode().is_err());
    let mut p = input(Operation::AcceptAdmin);
    p.eoa_admin = true;
    p.admin = address(99);
    let b = p.encode().unwrap();
    assert_eq!(&b[35..37], &[0; 2]);
    assert_eq!(&b[37..69], &[99; 32]);
    assert_eq!(&b[71..103], &CORE_PEER_MANAGER_PROGRAM_BYTES);
    assert_eq!(&b[105..137], &CORE_PEER_CONFIG_BYTES);
    assert!(
        input(Operation::ProposeAdmin {
            candidate: address(8),
            kind: 3
        })
        .encode()
        .is_err()
    );
}
#[test]
fn initialized_multisig_and_request_shape_are_not_interchangeable() {
    let mut state = vec![0; 1048];
    state[0] = 1;
    state[2] = 2;
    state[4] = 2;
    state[24..56].fill(1);
    state[56..88].fill(2);
    assert!(decode_account(InspectKind::Multisig, &state).is_ok());
    state[56..88].fill(1);
    assert!(decode_account(InspectKind::Multisig, &state).is_err());
    let mut request = vec![0; 1048];
    request[0] = 2; /* TN_MULTISIG_ACCOUNT_TYPE_REQUEST_V1 */
    request[4] = 2;
    request[6] = 2;
    assert!(decode_account(InspectKind::Multisig, &request).is_err());
    assert!(decode_account(InspectKind::Request, &request).is_err());
}
#[test]
fn config_validates_pending_and_reserved_bytes() {
    let mut b = vec![0; 72];
    b[0] = 2; /* TN_CORE_MANAGER_ACCOUNT_TYPE_CONFIG_V1 */
    b[1] = 1;
    b[8..40].fill(2);
    assert!(decode_account(InspectKind::Config, &b).is_ok());
    b[40] = 1;
    assert!(decode_account(InspectKind::Config, &b).is_err());
    b[2] = 2;
    b[3] = 1;
    assert!(decode_account(InspectKind::Config, &b).is_ok());
    b[4] = 1;
    assert!(decode_account(InspectKind::Config, &b).is_err());
    b[4] = 0;
    for account_type in [0, 1, 3] {
        b[0] = account_type;
        assert!(decode_account(InspectKind::Config, &b).is_err());
    }
    let mut legacy = vec![0; 80];
    legacy[..8].copy_from_slice(b"corecfg1");
    assert!(decode_account(InspectKind::Config, &legacy).is_err());
}
#[test]
fn cli_parses_real_governance_commands() {
    use clap::Parser;
    assert!(
        crate::cli::Cli::try_parse_from([
            "thru",
            "governance",
            "inspect",
            "00",
            "--kind",
            "config"
        ])
        .is_ok()
    );
    assert!(
        crate::cli::Cli::try_parse_from([
            "thru",
            "governance",
            "execute",
            "--plan",
            "reviewed.json",
            "--receipt",
            "receipt.json",
            "--signer",
            "executor"
        ])
        .is_ok()
    );
    assert!(
        crate::cli::Cli::try_parse_from([
            "thru",
            "governance",
            "plan",
            "--input",
            "input.json",
            "--output",
            "plan.json",
            "--reviewed-state-output",
            "state-plan.json"
        ])
        .is_ok()
    );
}
#[test]
fn canonical_reviewed_digest_is_order_independent() {
    assert_eq!(
        json_digest(&json!({"z":1,"a":{"b":2,"a":3}})),
        json_digest(&serde_json::from_str::<Value>("{\"a\":{\"a\":3,\"b\":2},\"z\":1}").unwrap())
    );
}

#[test]
fn reviewed_rotation_preserves_unaffected_roles() {
    let mut p = input(Operation::ProposeAdmin {
        candidate: address(8),
        kind: 1,
    });
    let role = json!({"kind":"multisig","admin":address(2),"pending_kind":"none","pending_admin":address(0)});
    let before = json!({"core":role,"core_peer":role,"feature_gate":{"creation":address(9)}});
    let mut after = before.clone();
    for key in ["core", "core_peer"] {
        after[key]["pending_kind"] = json!("eoa");
        after[key]["pending_admin"] = json!(address(8));
    }
    p.reviewed_state["roles"] = json!({"before":before,"after":after});
    assert!(Plan::new(p.clone()).unwrap().validate().is_ok());
    // Paired rotation (UNTO-3561): Core B's role must move with Core A's.
    let mut half = p.clone();
    half.reviewed_state["roles"]["after"]["core_peer"] = role.clone();
    assert!(Plan::new(half).unwrap().validate().is_err());
    let mut diverged = p.clone();
    diverged.reviewed_state["roles"]["before"]["core_peer"]["admin"] = json!(address(3));
    assert!(Plan::new(diverged).unwrap().validate().is_err());
    p.reviewed_state["roles"]["after"]["feature_gate"]["creation"] = json!(address(10));
    assert!(Plan::new(p).unwrap().validate().is_err());
}

#[test]
fn realistic_maximum_two_proof_refresh_fits_mtu() {
    let mut proof = vec![0; 8296];
    proof[..8].copy_from_slice(&(2u64 << 62).to_le_bytes());
    proof[8..40].fill(255);
    let p = input(Operation::AcceptAdmin);
    let mut seed = [0; 32];
    seed[..8].copy_from_slice(b"coreprf1");
    let slot = ProofSlot {
        address: address(6),
        seed: hex::encode(seed),
        metadata: address(3),
        program: address(4),
    };
    let writer = write_proof_slot(&p.accounts, &slot, &proof, &proof).unwrap();
    let calls = multicall(&[(2, writer), (3, vec![3, 0, 0, 0, 2, 0, 3, 0])]).unwrap();
    assert!(calls.len() + 8296 + 256 + 32 * 20 <= 32768);
    proof.push(0);
    assert!(validate_creation_proof(&proof).is_err());
}

#[test]
fn permanent_abi_metadata_proof_is_validated() {
    let mut proof = vec![0; 104];
    proof[..8].copy_from_slice(&(2u64 << 62).to_le_bytes());
    let make = |creation_proof| {
        input(Operation::Abi {
            action: AbiAction::CreateMetaPermanent,
            subject: address(4),
            program_metadata: Some(address(3)),
            abi_metadata: address(6),
            abi_content: None,
            image: None,
            creation_proof,
        })
    };
    assert_eq!(make(Some(hex::encode(&proof))).encode().unwrap().len(), 383);
    assert!(make(None).encode().is_err());
    proof[7] = 0;
    assert!(make(Some(hex::encode(&proof))).encode().is_err());
}

#[test]
fn root_close_is_not_offered() {
    let p = input(Operation::Abi {
        action: AbiAction::Close,
        subject: hex::encode(CORE_MANAGER_PROGRAM_BYTES),
        program_metadata: Some(address(3)),
        abi_metadata: address(6),
        abi_content: Some(address(7)),
        image: None,
        creation_proof: None,
    });
    assert!(p.encode().is_err());
}

#[test]
fn request_snapshot_and_threshold_fields_decode() {
    let plan = Plan::new(input(Operation::AcceptAdmin)).unwrap();
    let payload = plan.invoke().unwrap();
    let mut request = vec![0; 104];
    request[0] = 2; /* TN_MULTISIG_ACCOUNT_TYPE_REQUEST_V1 */
    request[4] = 2;
    request[6] = 2;
    request[24] = 3;
    request[32..40].copy_from_slice(&(payload.len() as u64).to_le_bytes());
    request[40..72].fill(2);
    request.extend(payload);
    assert_eq!(
        decode_account(InspectKind::Request, &request).unwrap()["approval_bitmap"],
        "3"
    );
    request[24] = 3;
    request[0] = 1; /* a Multisig account, not a request */
    assert!(decode_account(InspectKind::Request, &request).is_err());
    request[0] = 2;
    request[24] = 4;
    assert!(decode_account(InspectKind::Request, &request).is_err());
}

#[test]
fn request_limit_includes_all_reference_bindings() {
    let mut plan = Plan::new(input(Operation::AcceptAdmin)).unwrap();
    let overhead =
        44 + 34 * (1 + plan.input.accounts.read_write.len() + plan.input.accounts.read_only.len());
    plan.instruction = hex::encode(vec![0; 4096 - overhead]);
    assert_eq!(plan.invoke().unwrap().len(), 4096);
    plan.instruction.push_str("00");
    assert!(plan.invoke().is_err());
}

fn reviewed_record() -> Value {
    json!({"identity":"subject","address":address(4),"owner":hex::encode(CORE_MANAGER_PROGRAM_BYTES),"flags":5,
        "metadata":{"address":address(3),"owner":hex::encode(CORE_MANAGER_PROGRAM_BYTES),"flags":4,"version":"0","state":"open","authority":address(7),"candidate":address(0)},
        "executable":{"path":"image.bin","size":20,"sha256":address(0)}})
}
fn set_reviewed_change(p: &mut PlanInput, before: Value, after: Value) {
    p.reviewed_state["changes"] = json!([{"identity":"subject","before":before,"after":after}]);
}

#[test]
fn reviewed_pause_cannot_unpin_or_change_unrelated_flags() {
    let mut p = input(Operation::SetPause {
        metadata: address(3),
        program: address(4),
        paused: true,
    });
    let before = reviewed_record();
    let mut after = before.clone();
    after["metadata"]["state"] = json!("paused");
    after["flags"] = json!(4);
    set_reviewed_change(&mut p, before.clone(), after.clone());
    assert!(Plan::new(p.clone()).unwrap().validate().is_ok());
    for wrong in [0, 5, 12, 132] {
        after["flags"] = json!(wrong);
        set_reviewed_change(&mut p, before.clone(), after.clone());
        assert!(Plan::new(p.clone()).unwrap().validate().is_err());
    }
}

#[test]
fn reviewed_create_requires_exact_initialized_metadata_and_policy() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut bytes = vec![0; 20];
    bytes[0] = 1;
    fs::write(file.path(), &bytes).unwrap();
    let mut p = input(Operation::Create {
        metadata: address(3),
        program: address(4),
        seed: address(9),
        image: Image {
            source: address(5),
            offset: 0,
            length: 20,
            artifact: file.path().into(),
            sha256: digest(&bytes),
        },
        application_authority: address(7),
        pin: true,
        proof_slot: None,
    });
    let mut before = reviewed_record();
    before["flags"] = json!(0);
    before["metadata"]["flags"] = json!(0);
    let mut after = before.clone();
    after["flags"] = json!(13);
    after["metadata"]["flags"] = json!(12);
    after["executable"]["path"] = json!(file.path());
    after["executable"]["sha256"] = json!(digest(&bytes));
    set_reviewed_change(&mut p, before.clone(), after.clone());
    assert!(Plan::new(p.clone()).unwrap().validate().is_ok());
    for (path, wrong) in [
        ("/metadata/authority", json!(address(8))),
        ("/metadata/candidate", json!(address(8))),
        ("/metadata/version", json!("1")),
        ("/metadata/state", json!("paused")),
        ("/metadata/flags", json!(8)),
        ("/flags", json!(9)),
        ("/flags", json!(45)),
    ] {
        let mut bad = after.clone();
        *bad.pointer_mut(path).unwrap() = wrong;
        set_reviewed_change(&mut p, before.clone(), bad);
        assert!(
            Plan::new(p.clone()).unwrap().validate().is_err(),
            "accepted {path}"
        );
    }
}

#[test]
fn reviewed_creation_flags_follow_independent_runtime_classes() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut bytes = vec![0; 20];
    bytes[0] = 1;
    fs::write(file.path(), &bytes).unwrap();
    for (ephemeral, pin, first, second, first_after, second_after) in [
        (false, false, 0, 0, 33, 32),
        (false, true, 0, 0, 37, 36),
        (false, false, 0, 16, 33, 0),
        (false, false, 16, 0, 1, 32),
        (false, false, 48, 16, 33, 0),
        (false, false, 16, 48, 1, 32),
        (false, false, 180, 16, 37, 0),
        (false, true, 16, 176, 5, 36),
        (true, false, 0, 0, 9, 8),
        (true, true, 0, 0, 13, 12),
        (true, false, 156, 24, 9, 8),
        (true, true, 24, 156, 13, 12),
    ] {
        let mut seed = [0; 32];
        seed[..8].copy_from_slice(b"coreprf1");
        let mut p = input(Operation::Create {
            metadata: address(3),
            program: address(4),
            seed: address(9),
            image: Image {
                source: address(5),
                offset: 0,
                length: 20,
                artifact: file.path().into(),
                sha256: digest(&bytes),
            },
            application_authority: address(7),
            pin,
            proof_slot: (!ephemeral).then(|| ProofSlot {
                address: address(6),
                seed: hex::encode(seed),
                metadata: address(3),
                program: address(4),
            }),
        });
        let mut before = reviewed_record();
        before["flags"] = json!(first);
        before["metadata"]["flags"] = json!(second);
        let mut after = before.clone();
        after["flags"] = json!(first_after);
        after["metadata"]["flags"] = json!(second_after);
        after["executable"]["path"] = json!(file.path());
        after["executable"]["sha256"] = json!(digest(&bytes));
        set_reviewed_change(&mut p, before.clone(), after.clone());
        assert!(Plan::new(p.clone()).unwrap().validate().is_ok());
        for path in ["/flags", "/metadata/flags"] {
            for wrong in [
                json!(1),
                json!(4),
                json!(32),
                json!(64),
                json!(if ephemeral { 16 } else { 24 }),
                json!(-1),
                json!(256),
                json!(0.5),
            ] {
                let mut bad = before.clone();
                *bad.pointer_mut(path).unwrap() = wrong;
                set_reviewed_change(&mut p, bad, after.clone());
                assert!(Plan::new(p.clone()).unwrap().validate().is_err());
            }
            let expected = after.pointer(path).unwrap().as_u64().unwrap();
            for wrong in [
                expected ^ 32,
                expected ^ 4,
                expected ^ 8,
                expected | 16,
                expected | 64,
                expected | 128,
            ] {
                let mut bad = after.clone();
                *bad.pointer_mut(path).unwrap() = json!(wrong);
                set_reviewed_change(&mut p, before.clone(), bad);
                assert!(Plan::new(p.clone()).unwrap().validate().is_err());
            }
        }
    }
}

#[test]
fn reviewed_abi_creation_flags_follow_runtime_classes() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let bytes = include_bytes!("../../abi/tn_token_program.abi.yaml");
    fs::write(file.path(), bytes).unwrap();
    let mut proof = vec![0; 104];
    proof[..8].copy_from_slice(&(2u64 << 62).to_le_bytes());
    for metadata in [true, false] {
        for (ephemeral, old, new) in [
            (false, 0, 32),
            (false, 16, 0),
            (false, 48, 32),
            (false, 180, 36),
            (true, 0, 8),
            (true, 156, 8),
        ] {
            let action = match (metadata, ephemeral) {
                (true, false) => AbiAction::CreateMetaPermanent,
                (true, true) => AbiAction::CreateMetaEphemeral,
                (false, false) => AbiAction::CreateContentPermanent,
                (false, true) => AbiAction::CreateContentEphemeral,
            };
            let mut p = input(Operation::Abi {
                action,
                subject: address(4),
                program_metadata: Some(address(3)),
                abi_metadata: address(6),
                abi_content: (!metadata).then(|| address(7)),
                image: (!metadata).then(|| Image {
                    source: address(5),
                    offset: 0,
                    length: bytes.len() as u32,
                    artifact: file.path().into(),
                    sha256: digest(bytes),
                }),
                creation_proof: (!ephemeral).then(|| hex::encode(&proof)),
            });
            let mut before = reviewed_record();
            before["abi"] = json!({"metadata_address":address(6),"content_address":address(7),
                "owner":hex::encode(ABI_MANAGER_PROGRAM_BYTES),"metadata_flags":0,"content_flags":0,
                "state":"open","revision":"0","artifact":{"path":file.path(),"size":bytes.len(),"sha256":digest(bytes)}});
            let field = if metadata {
                "metadata_flags"
            } else {
                "content_flags"
            };
            before["abi"][field] = json!(old);
            let mut after = before.clone();
            after["abi"][field] = json!(new);
            set_reviewed_change(&mut p, before.clone(), after.clone());
            assert!(Plan::new(p.clone()).unwrap().validate().is_ok());
            for wrong in [new ^ 32, new ^ 4, new ^ 8, new | 16, new | 64, new | 128] {
                let mut bad = after.clone();
                bad["abi"][field] = json!(wrong);
                set_reviewed_change(&mut p, before.clone(), bad);
                assert!(Plan::new(p.clone()).unwrap().validate().is_err());
            }
            for wrong in [
                json!(1),
                json!(4),
                json!(32),
                json!(64),
                json!(if ephemeral { 16 } else { 24 }),
                json!(-1),
                json!(256),
                json!(0.5),
            ] {
                let mut bad = before.clone();
                bad["abi"][field] = wrong;
                set_reviewed_change(&mut p, bad, after.clone());
                assert!(Plan::new(p.clone()).unwrap().validate().is_err());
            }
        }
    }
}

#[test]
fn reviewed_destroy_preserves_pins_and_models_deletion_classes() {
    for (before_flags, metadata_flags, after_flags, after_metadata_flags) in [
        (5, 4, 4, 4),
        (13, 12, 28, 28),
        (37, 36, 52, 52),
        (33, 4, 48, 4),
        (5, 32, 4, 48),
        (161, 160, 48, 48),
    ] {
        let mut p = input(Operation::Destroy {
            metadata: address(3),
            program: address(4),
        });
        let mut before = reviewed_record();
        before["flags"] = json!(before_flags);
        before["metadata"]["flags"] = json!(metadata_flags);
        let mut after = before.clone();
        after["flags"] = json!(after_flags);
        after["metadata"]["flags"] = json!(after_metadata_flags);
        after["metadata"]["state"] = json!("destroyed");
        after["executable"]["size"] = json!(0);
        after["executable"]["sha256"] = json!(digest(&[]));
        set_reviewed_change(&mut p, before.clone(), after.clone());
        assert!(Plan::new(p.clone()).unwrap().validate().is_ok());
        for path in ["/flags", "/metadata/flags"] {
            for wrong in [json!(-1), json!(256), json!(0.5), json!(16), json!(64)] {
                let mut bad_before = before.clone();
                *bad_before.pointer_mut(path).unwrap() = wrong;
                set_reviewed_change(&mut p, bad_before, after.clone());
                assert!(Plan::new(p.clone()).unwrap().validate().is_err());
            }
            let expected = after.pointer(path).unwrap().as_u64().unwrap();
            for wrong in [expected ^ 16, expected ^ 32, expected ^ 2] {
                let mut bad_after = after.clone();
                *bad_after.pointer_mut(path).unwrap() = json!(wrong);
                set_reviewed_change(&mut p, before.clone(), bad_after);
                assert!(Plan::new(p.clone()).unwrap().validate().is_err());
            }
        }
        for (field, value) in [
            ("size", json!(20)),
            ("sha256", json!(address(0))),
            ("path", json!("unapproved-image.bin")),
        ] {
            let mut invalid_after = after.clone();
            invalid_after["executable"][field] = value;
            set_reviewed_change(&mut p, before.clone(), invalid_after);
            assert!(Plan::new(p.clone()).unwrap().validate().is_err());
        }
        after["flags"] = json!(after_flags ^ 4);
        set_reviewed_change(&mut p, before, after);
        assert!(Plan::new(p).unwrap().validate().is_err());
    }
}

#[test]
fn reviewed_abi_close_deletes_only_content_with_exact_class_flags() {
    for (old, new) in [(4, 4), (8, 24), (32, 48), (160, 48)] {
        let mut p = input(Operation::Abi {
            action: AbiAction::Close,
            subject: address(4),
            program_metadata: Some(address(3)),
            abi_metadata: address(6),
            abi_content: Some(address(7)),
            image: None,
            creation_proof: None,
        });
        let mut before = reviewed_record();
        before["abi"] = json!({"metadata_address":address(6),"content_address":address(7),
            "owner":hex::encode(ABI_MANAGER_PROGRAM_BYTES),"metadata_flags":8,"content_flags":old,
            "state":"finalized","revision":"3","artifact":{"path":"abi.yaml","size":3,"sha256":digest(b"abi")}});
        let mut after = before.clone();
        after["abi"]["state"] = json!("closed");
        after["abi"]["content_flags"] = json!(new);
        set_reviewed_change(&mut p, before.clone(), after.clone());
        assert!(Plan::new(p.clone()).unwrap().validate().is_ok());
        for (path, value) in [
            ("/abi/content_flags", json!(new ^ 16)),
            ("/abi/content_flags", json!(new ^ 32)),
            ("/abi/content_flags", json!(new ^ 4)),
            ("/abi/metadata_flags", json!(24)),
            ("/abi/artifact/sha256", json!(address(0))),
            ("/abi/revision", json!("4")),
        ] {
            let mut wrong = after.clone();
            *wrong.pointer_mut(path).unwrap() = value;
            set_reviewed_change(&mut p, before.clone(), wrong);
            assert!(Plan::new(p.clone()).unwrap().validate().is_err());
        }
        for flags in [
            json!(-1),
            json!(256),
            json!(0.5),
            json!(old | 16),
            json!(old | 64),
        ] {
            let mut wrong = before.clone();
            wrong["abi"]["content_flags"] = flags;
            set_reviewed_change(&mut p, wrong, after.clone());
            assert!(Plan::new(p.clone()).unwrap().validate().is_err());
        }
    }
}

#[test]
fn governed_abi_semantics_reject_missing_types_roots_and_cycles() {
    let original: Value =
        serde_yml::from_slice(include_bytes!("../../abi/tn_token_program.abi.yaml")).unwrap();
    let check = |value: &Value| {
        let bytes = serde_yml::to_string(value).unwrap().into_bytes();
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), &bytes).unwrap();
        let image = Image {
            source: address(5),
            offset: 0,
            length: bytes.len() as u32,
            artifact: file.path().into(),
            sha256: digest(&bytes),
        };
        let result = Plan::new(input(Operation::Abi {
            action: AbiAction::Upgrade,
            subject: address(4),
            program_metadata: Some(address(3)),
            abi_metadata: address(6),
            abi_content: Some(address(7)),
            image: Some(image),
            creation_proof: None,
        }));
        assert_eq!(
            fs::read(file.path()).unwrap(),
            bytes,
            "validation must not rewrite reviewed bytes"
        );
        result
    };
    assert!(check(&original).is_ok());
    let mut missing_root = original.clone();
    missing_root["abi"]["options"]["program-metadata"]["root-types"]["account-root"] =
        json!("MissingRoot");
    assert!(check(&missing_root).is_err());
    let mut missing_type = original.clone();
    missing_type["types"][0]["kind"] = json!({"type-ref":{"name":"MissingType"}});
    assert!(check(&missing_type).is_err());
    let mut cyclic = original.clone();
    let name = cyclic["types"][0]["name"].clone();
    cyclic["types"][0]["kind"] = json!({"type-ref":{"name":name}});
    assert!(check(&cyclic).is_err());
}

#[test]
fn reviewed_rotation_registers_only_the_bound_candidate() {
    let mut p = input(Operation::ProposeAdmin {
        candidate: address(8),
        kind: 2,
    });
    let role = json!({"kind":"multisig","admin":address(2),"pending_kind":"none","pending_admin":address(0)});
    let before = json!({"core":role,"core_peer":role,"multisigs":{}});
    let mut after = before.clone();
    for key in ["core", "core_peer"] {
        after[key]["pending_kind"] = json!("multisig");
        after[key]["pending_admin"] = json!(address(8));
    }
    after["multisigs"]["candidate"] =
        json!({"address":address(8),"members":[address(10),address(11)],"threshold":2,"flags":4});
    p.reviewed_state["roles"] = json!({"before":before,"after":after});
    assert!(Plan::new(p.clone()).unwrap().validate().is_ok());
    p.reviewed_state["roles"]["after"]["multisigs"]["candidate"]["address"] = json!(address(9));
    assert!(Plan::new(p).unwrap().validate().is_err());
}

fn candidate_fixture(flags: u8) -> (Value, thru_client::Account) {
    let descriptor = json!({"address":address(8),"members":[address(10),address(11)],"threshold":2,"flags":flags});
    let mut bytes = [0; 1048];
    bytes[0] = 1;
    bytes[2..4].copy_from_slice(&2u16.to_le_bytes());
    bytes[4..6].copy_from_slice(&2u16.to_le_bytes());
    bytes[24..56].fill(10);
    bytes[56..88].fill(11);
    let account = thru_client::Account {
        balance: 0,
        data: Some(base64::engine::general_purpose::STANDARD.encode(bytes)),
        owner: Pubkey::from_bytes(&MULTISIG_PROGRAM_BYTES),
        flags,
        program: false,
        data_size: bytes.len() as u64,
        nonce: 0,
        seq: 0,
        is_new: false,
        is_ephemeral: false,
        is_deleted: false,
        is_privileged: false,
        is_uncompressable: false,
        is_native_receiver: false,
        slot: None,
        block_timestamp: None,
        version_seq: None,
        block_offset: None,
    };
    (descriptor, account)
}

#[test]
fn reviewed_multisig_flags_must_be_canonical_durable_flags() {
    let (mut descriptor, _) = candidate_fixture(0);
    for flags in 0..=256 {
        descriptor["flags"] = json!(flags);
        assert_eq!(
            validate_multisig_descriptor(&descriptor).is_ok(),
            flags == 0 || flags == 4,
            "reviewed flags {flags}"
        );
    }
    for flags in [json!(-1), json!(0.5), json!("0"), Value::Null] {
        descriptor["flags"] = flags;
        assert!(validate_multisig_descriptor(&descriptor).is_err());
    }
}

#[test]
fn candidate_comparison_ignores_only_live_new() {
    for durable in [0, TN_ACCOUNT_FLAG_UNCOMPRESSABLE] {
        let (descriptor, mut account) = candidate_fixture(durable);
        for live in 0..=u8::MAX {
            account.flags = live;
            account.is_new = live & TN_ACCOUNT_FLAG_NEW != 0;
            assert_eq!(
                verify_candidate_account(&descriptor, &account).is_ok(),
                live == durable || live == durable | TN_ACCOUNT_FLAG_NEW,
                "reviewed flags {durable}, live flags {live}"
            );
        }
    }
}

#[test]
fn new_candidate_still_requires_reviewed_owner_members_and_threshold() {
    for durable in [0, TN_ACCOUNT_FLAG_UNCOMPRESSABLE] {
        for live in [durable | TN_ACCOUNT_FLAG_NEW, durable] {
            let (descriptor, mut account) = candidate_fixture(durable);
            account.flags = live;
            account.is_new = live & TN_ACCOUNT_FLAG_NEW != 0;
            let mut wrong_owner = account.clone();
            wrong_owner.owner = Pubkey::from_bytes(&[99; 32]);
            assert!(
                verify_candidate_account(&descriptor, &wrong_owner)
                    .unwrap_err()
                    .to_string()
                    .contains("owner/flags")
            );
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(account.data.as_ref().unwrap())
                .unwrap();
            for drift in ["members", "threshold"] {
                let mut changed = bytes.clone();
                if drift == "members" {
                    changed[56..88].fill(12);
                } else {
                    changed[4..6].copy_from_slice(&1u16.to_le_bytes());
                }
                account.data = Some(base64::engine::general_purpose::STANDARD.encode(changed));
                assert!(
                    verify_candidate_account(&descriptor, &account)
                        .unwrap_err()
                        .to_string()
                        .contains("membership/threshold")
                );
            }
        }
    }
}

fn direct_layout(p: &mut PlanInput, eoa: bool) {
    p.eoa_admin = eoa;
    p.admin = if eoa { address(99) } else { address(2) };
    p.wrapper = if eoa {
        p.target_program.clone()
    } else {
        hex::encode(MULTISIG_PROGRAM_BYTES)
    };
    p.accounts.read_write.retain(|a| a != &p.wrapper);
    p.accounts.read_only.retain(|a| a != &p.wrapper);
}

// Exercise the production instruction selection and the same wire builder used
// by submit, including duplicate/sort checks and decoding the resulting table.
fn execution_transaction(plan: &Plan) -> thru_base::txn_lib::Transaction {
    use thru_base::txn_lib::Transaction;
    let p = &plan.input;
    let request = address(8);
    let call = plan
        .execution_call((!p.eoa_admin).then_some(request.as_str()))
        .unwrap();
    let bytes = p.transaction_instruction(vec![call]).unwrap();
    let tx = Transaction::new([99; 32], key(&p.wrapper).unwrap(), 1, 0)
        .with_rw_accounts(
            p.accounts
                .read_write
                .iter()
                .map(|a| key(a).unwrap())
                .collect(),
        )
        .with_r_accounts(
            p.accounts
                .read_only
                .iter()
                .map(|a| key(a).unwrap())
                .collect(),
        )
        .with_instructions(bytes);
    let decoded = Transaction::from_wire(&tx.try_to_wire().unwrap()).unwrap();
    if !p.eoa_admin {
        let payload = plan.invoke().unwrap();
        let table: Vec<_> = [decoded.fee_payer, decoded.program]
            .into_iter()
            .chain(decoded.rw_accs.clone().unwrap_or_default())
            .chain(decoded.r_accs.clone().unwrap_or_default())
            .collect();
        let count = u16_at(&payload, 2) as usize;
        assert_eq!(&payload[12..44], &table[u16_at(&payload, 0) as usize]);
        for i in 0..count {
            let index = u16_at(&payload, 44 + i * 2) as usize;
            assert_eq!(
                &payload[44 + count * 2 + i * 32..44 + count * 2 + (i + 1) * 32],
                &table[index]
            );
        }
        assert_eq!(u16_at(&payload, 44), 1);
        assert_eq!(
            &payload[44 + count * 34..],
            hex::decode(&plan.instruction).unwrap()
        );
    }
    decoded
}

#[test]
fn multicall_lifecycle_uses_non_reentrant_direct_transactions() {
    for subject in [MULTICALL_PROGRAM_BYTES, [4; 32]] {
        for eoa in [true, false] {
            for paused in [true, false] {
                let mut p = input(Operation::SetPause {
                    metadata: address(3),
                    program: hex::encode(subject),
                    paused,
                });
                direct_layout(&mut p, eoa);
                if subject == MULTICALL_PROGRAM_BYTES {
                    p.accounts.read_write.push(hex::encode(subject));
                    p.accounts.read_write.sort_by_key(|a| key(a).unwrap());
                }
                let mut before = reviewed_record();
                before["address"] = json!(hex::encode(subject));
                before["metadata"]["state"] = json!(if paused { "open" } else { "paused" });
                before["flags"] = json!(if paused { 5 } else { 4 });
                let mut after = before.clone();
                after["metadata"]["state"] = json!(if paused { "paused" } else { "open" });
                after["flags"] = json!(if paused { 4 } else { 5 });
                set_reviewed_change(&mut p, before, after);
                let plan = Plan::new(p).unwrap();
                plan.validate().unwrap();
                let tx = execution_transaction(&plan);
                assert_ne!(tx.program, MULTICALL_PROGRAM_BYTES);
                assert_eq!(
                    tx.program,
                    if eoa {
                        CORE_MANAGER_PROGRAM_BYTES
                    } else {
                        MULTISIG_PROGRAM_BYTES
                    }
                );
                let child = hex::decode(&plan.instruction).unwrap();
                let subject_index = u16_at(&child, 103) as usize;
                assert!(subject_index >= 2);
                assert_eq!(tx.rw_accs.as_ref().unwrap()[subject_index - 2], subject);
                assert_eq!(child[137], u8::from(paused));
                let bytes = tx.instructions.unwrap();
                if eoa {
                    assert_eq!(bytes, child);
                } else {
                    assert_eq!(&bytes[..4], &3u32.to_le_bytes());
                    assert_eq!(bytes.len(), 8);
                }
            }
        }
    }
}

#[test]
fn multicall_official_abi_binds_slot_one_or_direct_fixed_subject() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let yaml =
        include_bytes!("../../../../../../programs/bootstrap/generated/tn_multicall.abi.yaml");
    fs::write(file.path(), yaml).unwrap();
    for subject in [MULTICALL_PROGRAM_BYTES, [4; 32]] {
        for direct in [false, true] {
            for eoa in [true, false] {
                for action in [
                    AbiAction::CreateMetaPermanent,
                    AbiAction::CreateMetaEphemeral,
                    AbiAction::CreateContentPermanent,
                    AbiAction::CreateContentEphemeral,
                    AbiAction::Upgrade,
                    AbiAction::Close,
                    AbiAction::Finalize,
                ] {
                    let upgrade = matches!(action, AbiAction::Upgrade);
                    let metadata = matches!(
                        action,
                        AbiAction::CreateMetaPermanent | AbiAction::CreateMetaEphemeral
                    );
                    let image = upgrade
                        || matches!(
                            action,
                            AbiAction::CreateContentPermanent | AbiAction::CreateContentEphemeral
                        );
                    let permanent = matches!(
                        action,
                        AbiAction::CreateMetaPermanent | AbiAction::CreateContentPermanent
                    );
                    let mut proof = vec![0; 104];
                    proof[..8].copy_from_slice(&(2u64 << 62).to_le_bytes());
                    let mut p = input(Operation::Abi {
                        action,
                        subject: hex::encode(subject),
                        program_metadata: Some(address(3)),
                        abi_metadata: address(6),
                        abi_content: (!metadata).then(|| address(7)),
                        image: image.then(|| Image {
                            source: address(5),
                            offset: 0,
                            length: yaml.len() as u32,
                            artifact: file.path().into(),
                            sha256: digest(yaml),
                        }),
                        creation_proof: permanent.then(|| hex::encode(&proof)),
                    });
                    p.eoa_admin = eoa;
                    p.admin = if eoa { address(99) } else { address(2) };
                    if direct {
                        direct_layout(&mut p, eoa);
                        if subject == MULTICALL_PROGRAM_BYTES {
                            p.accounts.read_only.push(hex::encode(subject));
                            p.accounts.read_only.sort_by_key(|a| key(a).unwrap());
                        }
                    }
                    let mut before = reviewed_record();
                    before["address"] = json!(hex::encode(subject));
                    before["abi"] = json!({"metadata_address":address(6),"content_address":address(7),"content_flags":4,"metadata_flags":4,"state":"open","revision":"0","artifact":{"path":"old.yaml","size":1,"sha256":address(0)}});
                    let created_field = match action {
                        AbiAction::CreateMetaPermanent | AbiAction::CreateMetaEphemeral => {
                            Some("metadata_flags")
                        }
                        AbiAction::CreateContentPermanent | AbiAction::CreateContentEphemeral => {
                            Some("content_flags")
                        }
                        _ => None,
                    };
                    if let Some(field) = created_field {
                        before["abi"][field] = json!(0);
                    }
                    let mut after = before.clone();
                    if let Some(field) = created_field {
                        after["abi"][field] = json!(if permanent { 32 } else { 8 });
                    }
                    if image {
                        after["abi"]["artifact"] =
                            json!({"path":file.path(),"size":yaml.len(),"sha256":digest(yaml)});
                    }
                    if upgrade {
                        after["abi"]["revision"] = json!("1");
                    } else if matches!(action, AbiAction::Close | AbiAction::Finalize) {
                        after["abi"]["state"] = json!(if matches!(action, AbiAction::Close) {
                            "closed"
                        } else {
                            "finalized"
                        });
                    }
                    set_reviewed_change(&mut p, before, after);
                    let plan = Plan::new(p).unwrap();
                    plan.validate().unwrap();
                    let tx = execution_transaction(&plan);
                    let child = hex::decode(&plan.instruction).unwrap();
                    assert_eq!(&child[71..103], &subject);
                    assert_eq!(
                        u16_at(&child, 69) == 1,
                        !direct && subject == MULTICALL_PROGRAM_BYTES
                    );
                    assert_eq!(tx.program == MULTICALL_PROGRAM_BYTES, !direct);
                    if direct && eoa {
                        assert_eq!(tx.instructions.unwrap(), child);
                    }
                }
            }
        }
    }
}

#[test]
fn direct_layout_rejects_duplicate_root_and_wrapped_or_wrong_target_calls() {
    let mut p = input(Operation::SetPause {
        metadata: address(3),
        program: hex::encode(MULTICALL_PROGRAM_BYTES),
        paused: true,
    });
    assert!(Plan::new(p.clone()).is_err(), "slot one cannot be writable");
    p.accounts
        .read_write
        .push(hex::encode(MULTICALL_PROGRAM_BYTES));
    p.accounts.read_write.sort_by_key(|a| key(a).unwrap());
    assert!(
        Plan::new(p.clone()).is_err(),
        "duplicate slot one is invalid"
    );
    direct_layout(&mut p, true);
    let plan = Plan::new(p).unwrap();
    assert!(
        plan.input
            .transaction_instruction(vec![(2, vec![3])])
            .is_err()
    );
    assert!(
        plan.input
            .transaction_instruction(vec![(1, vec![10]), (1, vec![0])])
            .is_err()
    );
    let mut duplicate = plan.input.clone();
    duplicate.accounts.read_only.push(duplicate.wrapper.clone());
    duplicate
        .accounts
        .read_only
        .sort_by_key(|a| key(a).unwrap());
    assert!(Plan::new(duplicate).is_err());
}

#[test]
fn multicall_remaining_lifecycle_and_recreation_have_direct_execution_routes() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let mut bytes = vec![0; 20];
    bytes[0] = 1;
    fs::write(file.path(), &bytes).unwrap();
    let image = Image {
        source: address(5),
        offset: 0,
        length: 20,
        artifact: file.path().into(),
        sha256: digest(&bytes),
    };
    let program = hex::encode(MULTICALL_PROGRAM_BYTES);
    let mut seed = [0; 32];
    seed[..8].copy_from_slice(b"coreprf1");
    let slot = ProofSlot {
        address: address(6),
        seed: hex::encode(seed),
        metadata: address(3),
        program: program.clone(),
    };
    let operations = [
        Operation::Create {
            metadata: address(3),
            program: program.clone(),
            seed: address(9),
            image: image.clone(),
            application_authority: address(7),
            pin: true,
            proof_slot: Some(slot),
        },
        Operation::Upgrade {
            metadata: address(3),
            program: program.clone(),
            image,
        },
        Operation::Destroy {
            metadata: address(3),
            program: program.clone(),
        },
        Operation::Finalize {
            metadata: address(3),
            program: program.clone(),
        },
        Operation::SetApplicationAuthority {
            metadata: address(3),
            program: program.clone(),
            authority: address(10),
        },
        Operation::SetPin {
            target: program.clone(),
            pin: false,
        },
    ];
    for eoa in [true, false] {
        for operation in &operations {
            let mut p = input(operation.clone());
            direct_layout(&mut p, eoa);
            p.accounts.read_write.push(program.clone());
            p.accounts.read_write.sort_by_key(|a| key(a).unwrap());
            let mut before = reviewed_record();
            before["address"] = json!(program);
            let mut after = before.clone();
            match operation {
                Operation::Create { image, .. } => {
                    before["metadata"]["state"] = json!("destroyed");
                    before["flags"] = json!(52);
                    before["metadata"]["flags"] = json!(52);
                    after["flags"] = json!(37);
                    after["metadata"]["flags"] = json!(36);
                    after["executable"] =
                        json!({"path":image.artifact,"size":image.length,"sha256":image.sha256});
                }
                Operation::Upgrade { image, .. } => {
                    after["metadata"]["version"] = json!("1");
                    after["executable"] =
                        json!({"path":image.artifact,"size":image.length,"sha256":image.sha256});
                }
                Operation::Destroy { .. } => {
                    after["flags"] = json!(4);
                    after["metadata"]["state"] = json!("destroyed");
                    after["executable"]["size"] = json!(0);
                    after["executable"]["sha256"] = json!(digest(&[]));
                }
                Operation::Finalize { .. } => after["metadata"]["state"] = json!("finalized"),
                Operation::SetApplicationAuthority { authority, .. } => {
                    after["metadata"]["authority"] = json!(authority)
                }
                Operation::SetPin { .. } => after["flags"] = json!(1),
                _ => unreachable!(),
            }
            set_reviewed_change(&mut p, before, after);
            let plan = Plan::new(p).unwrap();
            plan.validate().unwrap();
            let tx = execution_transaction(&plan);
            assert_ne!(tx.program, MULTICALL_PROGRAM_BYTES);
            assert!(tx.rw_accs.unwrap().contains(&MULTICALL_PROGRAM_BYTES));
            assert_eq!(
                plan.execution_mode().unwrap(),
                if matches!(operation, Operation::Create { .. }) {
                    "standalone-proof-refresh-then-direct"
                } else {
                    "direct"
                }
            );
        }
    }
}

#[test]
fn standalone_refresh_has_its_own_core_layout_without_rebinding_approval() {
    use thru_base::txn_lib::Transaction;
    let mut seed = [0; 32];
    seed[..8].copy_from_slice(b"coreprf1");
    let slot = ProofSlot {
        address: address(6),
        seed: hex::encode(seed),
        metadata: address(3),
        program: hex::encode(MULTICALL_PROGRAM_BYTES),
    };
    let mut proof = vec![0; 104];
    proof[..8].copy_from_slice(&(2u64 << 62).to_le_bytes());
    let (accounts, bytes) = standalone_proof_refresh(&slot, &proof, &proof).unwrap();
    let tx = Transaction::new([99; 32], CORE_MANAGER_PROGRAM_BYTES, 1, 0)
        .with_rw_accounts(
            accounts
                .read_write
                .iter()
                .map(|a| key(a).unwrap())
                .collect(),
        )
        .with_instructions(bytes);
    let decoded = Transaction::from_wire(&tx.try_to_wire().unwrap()).unwrap();
    assert_eq!(decoded.program, CORE_MANAGER_PROGRAM_BYTES);
    assert_eq!(decoded.rw_accs.unwrap(), vec![[6; 32]]);
    let writer = decoded.instructions.unwrap();
    assert_eq!(writer[0], 10);
    assert_eq!(u16_at(&writer, 1), 2);
    assert_eq!(&writer[3..35], &[6; 32]);
    assert_eq!(&writer[75..179], &proof);
    assert_eq!(&writer[179..], &proof);
    let mut wrapped = input(Operation::AcceptAdmin);
    let call = (
        wrapped.index(&wrapped.target_program, None).unwrap(),
        write_proof_slot(&wrapped.accounts, &slot, &proof, &proof).unwrap(),
    );
    let encoded = wrapped
        .transaction_instruction(vec![call.clone(), (3, vec![3, 0, 0, 0])])
        .unwrap();
    assert_eq!(u16_at(&encoded, 0), 2);
    assert_eq!(u16_at(&encoded, 2), call.0);
    assert_eq!(&encoded[12..12 + call.1.len()], &call.1);
    direct_layout(&mut wrapped, false);
    let plan = Plan::new(wrapped).unwrap();
    let approved = plan.invoke().unwrap();
    proof[0] = 1;
    let (_, refreshed) = standalone_proof_refresh(&slot, &proof, &proof).unwrap();
    assert_ne!(writer, refreshed);
    assert_eq!(approved, plan.invoke().unwrap());
}
